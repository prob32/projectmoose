/**
 * Force-directed physics engine for the agent canvas.
 *
 * Provides organic node layout via:
 * - Charge repulsion (all-pairs, prevents overlap)
 * - Link springs (parent-child connections pull toward ideal distance)
 * - Center gravity (prevents drift)
 * - Velocity damping (nodes glide to rest)
 * - Alpha cooling (simulation auto-stops when settled)
 *
 * Runs in requestAnimationFrame, outside Solid.js reactivity.
 * Syncs positions to the store via batched updates at ~30fps.
 */

// ===== Types =====

export type PhysicsNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Fixed position X (non-null when node is being dragged) */
  fx: number | null
  /** Fixed position Y (non-null when node is being dragged) */
  fy: number | null
  /** Collision radius — half the visual node diameter */
  radius: number
  /** Mass affects force response (heavier = less movement) */
  mass: number
}

export type PhysicsLink = {
  source: string
  target: string
  /** Ideal spring rest length in px */
  distance: number
  /** Spring stiffness (0–1) */
  strength: number
}

export type PhysicsConfig = {
  repulsionStrength: number
  linkStrength: number
  linkDistance: number
  gravityStrength: number
  gravityCenter: { x: number; y: number }

  alpha: number
  alphaDecay: number
  alphaMin: number
  alphaTarget: number
  velocityDecay: number
}

export type OnTickCallback = (nodes: Map<string, PhysicsNode>) => void
export type OnSettleCallback = (nodes: Map<string, PhysicsNode>) => void

// ===== Default Config =====

const DEFAULT_CONFIG: PhysicsConfig = {
  repulsionStrength: -500,
  linkStrength: 0.15,
  linkDistance: 160,
  gravityStrength: 0.01,
  gravityCenter: { x: 400, y: 300 },

  alpha: 1.0,
  alphaDecay: 0.04,
  alphaMin: 0.005,
  alphaTarget: 0,
  velocityDecay: 0.5,
}

// ===== Physics Engine =====

export class CanvasPhysics {
  private nodes: Map<string, PhysicsNode> = new Map()
  private links: PhysicsLink[] = []
  private config: PhysicsConfig
  private rafId: number | null = null
  private onTick: OnTickCallback | null = null
  private onSettle: OnSettleCallback | null = null

  /** Throttle DOM sync to ~30fps */
  private lastSyncTime = 0
  private readonly SYNC_INTERVAL = 1000 / 30

  constructor(config?: Partial<PhysicsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ===== Node Management =====

  addNode(node: Omit<PhysicsNode, "vx" | "vy" | "fx" | "fy" | "radius" | "mass"> & Partial<PhysicsNode>): PhysicsNode {
    const full: PhysicsNode = {
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius: 36,
      mass: 1,
      ...node,
    }
    this.nodes.set(full.id, full)
    return full
  }

  removeNode(id: string) {
    this.nodes.delete(id)
    this.links = this.links.filter((l) => l.source !== id && l.target !== id)
  }

  getNode(id: string): PhysicsNode | undefined {
    return this.nodes.get(id)
  }

  /** Update a node's stored position (e.g. from backend sync). Does NOT reheat. */
  updateNodePosition(id: string, x: number, y: number) {
    const node = this.nodes.get(id)
    if (node) {
      node.x = x
      node.y = y
    }
  }

  // ===== Link Management =====

  addLink(source: string, target: string, distance?: number, strength?: number): PhysicsLink {
    const link: PhysicsLink = {
      source,
      target,
      distance: distance ?? this.config.linkDistance,
      strength: strength ?? this.config.linkStrength,
    }
    // Avoid duplicate links
    const exists = this.links.find((l) => l.source === source && l.target === target)
    if (!exists) {
      this.links.push(link)
    }
    return link
  }

  removeLink(source: string, target: string) {
    this.links = this.links.filter((l) => !(l.source === source && l.target === target))
  }

  // ===== Drag Interaction =====

  startDrag(id: string, x: number, y: number) {
    const node = this.nodes.get(id)
    if (node) {
      node.fx = x
      node.fy = y
      node.vx = 0
      node.vy = 0
      this.reheat(0.05)
    }
  }

  drag(id: string, x: number, y: number) {
    const node = this.nodes.get(id)
    if (node) {
      node.fx = x
      node.fy = y
    }
  }

  endDrag(id: string) {
    const node = this.nodes.get(id)
    if (node) {
      node.fx = null
      node.fy = null
      node.vx = 0
      node.vy = 0
    }
  }

  // ===== Spawn Physics =====

  /** Spawn a new node from a parent with initial outward velocity */
  spawnNode(
    node: Omit<PhysicsNode, "vx" | "vy" | "fx" | "fy" | "radius" | "mass"> & Partial<PhysicsNode>,
    parentID?: string,
  ): PhysicsNode {
    const parent = parentID ? this.nodes.get(parentID) : undefined
    const full = this.addNode(node)

    if (parent) {
      // Start well outside parent's collision zone (radius*2 = 72px, so 140px offset)
      const angle = Math.random() * Math.PI * 2
      full.x = parent.x + Math.cos(angle) * 140
      full.y = parent.y + Math.sin(angle) * 140
      // Strong outward velocity to punch through damping
      full.vx = Math.cos(angle) * 10
      full.vy = Math.sin(angle) * 10
    }

    // Vigorous reheat so everything readjusts and separates
    this.reheat(0.5)
    return full
  }

  // ===== Simulation Control =====

  reheat(minAlpha = 0.3) {
    this.config.alpha = Math.max(this.config.alpha, minAlpha)
    this.start()
  }

  start() {
    if (this.rafId !== null) return // already running
    this.rafId = requestAnimationFrame(this.loop)
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  isRunning(): boolean {
    return this.rafId !== null
  }

  setOnTick(cb: OnTickCallback) {
    this.onTick = cb
  }

  setOnSettle(cb: OnSettleCallback) {
    this.onSettle = cb
  }

  setGravityCenter(x: number, y: number) {
    this.config.gravityCenter = { x, y }
  }

  getConfig(): Readonly<PhysicsConfig> {
    return this.config
  }

  getAllNodes(): ReadonlyMap<string, PhysicsNode> {
    return this.nodes
  }

  // ===== Main Loop =====

  private loop = (_time: number) => {
    this.tick()

    // Sync to store at throttled rate
    const now = performance.now()
    if (now - this.lastSyncTime >= this.SYNC_INTERVAL) {
      this.lastSyncTime = now
      this.onTick?.(this.nodes)
    }

    // Alpha decay
    this.config.alpha += (this.config.alphaTarget - this.config.alpha) * this.config.alphaDecay

    // Check if settled
    if (this.config.alpha < this.config.alphaMin) {
      this.config.alpha = 0
      this.stop()
      // Final sync
      this.onTick?.(this.nodes)
      this.onSettle?.(this.nodes)
      return
    }

    this.rafId = requestAnimationFrame(this.loop)
  }

  private tick() {
    const alpha = this.config.alpha
    const nodes = Array.from(this.nodes.values())
    const n = nodes.length

    // 1. Charge repulsion (all-pairs, O(N^2) — fine for <50 nodes)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy

        // Prevent division by zero — use deterministic offset, not random
        if (distSq < 1) {
          dx = (i - j) * 0.1 + 0.01
          dy = (j - i) * 0.1 + 0.01
          distSq = dx * dx + dy * dy
        }

        const dist = Math.sqrt(distSq)
        const minDist = a.radius + b.radius

        // Soft clamped repulsion — force decays with square distance, capped to avoid extreme spikes
        const effectiveDist = Math.max(dist, minDist * 0.5)
        const rawForce = (this.config.repulsionStrength * alpha) / (effectiveDist * effectiveDist)
        // Cap max force magnitude to prevent violent jumps
        const maxForce = 12 * alpha
        const force = Math.max(-maxForce, Math.min(maxForce, rawForce))

        const fx = (force * dx) / dist
        const fy = (force * dy) / dist

        // Apply to both nodes (equal and opposite)
        if (a.fx === null) {
          a.vx -= fx / a.mass
          a.vy -= fy / a.mass
        }
        if (b.fx === null) {
          b.vx += fx / b.mass
          b.vy += fy / b.mass
        }

        // Soft collision: push apart if overlapping (strong, minimum floor to always separate)
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2
          const pushFactor = Math.max(0.6, 0.8 * alpha)
          const pushX = (overlap * dx * pushFactor) / dist
          const pushY = (overlap * dy * pushFactor) / dist
          if (a.fx === null) {
            a.x -= pushX
            a.y -= pushY
          }
          if (b.fx === null) {
            b.x += pushX
            b.y += pushY
          }
        }
      }
    }

    // 2. Link springs
    for (const link of this.links) {
      const source = this.nodes.get(link.source)
      const target = this.nodes.get(link.target)
      if (!source || !target) continue

      let dx = target.x - source.x
      let dy = target.y - source.y
      let dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1) dist = 1

      const displacement = dist - link.distance
      const force = displacement * link.strength * alpha
      const fx = (force * dx) / dist
      const fy = (force * dy) / dist

      // Split force between source and target
      if (source.fx === null) {
        source.vx += fx / source.mass
        source.vy += fy / source.mass
      }
      if (target.fx === null) {
        target.vx -= fx / target.mass
        target.vy -= fy / target.mass
      }
    }

    // 3. Center gravity
    const { gravityStrength, gravityCenter } = this.config
    for (const node of nodes) {
      if (node.fx !== null) continue
      const dx = gravityCenter.x - node.x
      const dy = gravityCenter.y - node.y
      node.vx += dx * gravityStrength * alpha
      node.vy += dy * gravityStrength * alpha
    }

    // 4. Velocity integration + damping
    const damping = 1 - this.config.velocityDecay
    for (const node of nodes) {
      if (node.fx !== null) {
        node.x = node.fx
        node.vx = 0
      } else {
        node.vx *= damping
        node.x += node.vx
      }
      if (node.fy !== null) {
        node.y = node.fy
        node.vy = 0
      } else {
        node.vy *= damping
        node.y += node.vy
      }

      // Clamp very small velocities to zero (prevents micro-jitter at end of simulation)
      if (Math.abs(node.vx) < 0.01) node.vx = 0
      if (Math.abs(node.vy) < 0.01) node.vy = 0

      // Keep nodes within reasonable bounds
      node.x = Math.max(-2000, Math.min(4000, node.x))
      node.y = Math.max(-2000, Math.min(4000, node.y))
    }
  }

  // ===== Cleanup =====

  destroy() {
    this.stop()
    this.nodes.clear()
    this.links = []
    this.onTick = null
    this.onSettle = null
  }
}
