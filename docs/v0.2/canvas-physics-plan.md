# Canvas Physics & Animation Upgrade

## Overview

Replace the current static positioning system with a **force-directed physics simulation** inspired by [amcharts force-directed tree](https://www.amcharts.com/demos-v4/force-directed-tree-v4/). Nodes should feel alive — gently floating, smoothly repelling each other, and settling into organic layouts with springy connection lines.

The current system has:
- **Zero physics** — positions are static, set by drag or backend
- **No interpolation** — store updates instantly jump the DOM
- **Jittery drag** — `pointerMove` fires 60+ times/sec directly mutating the store with no smoothing
- **CSS-only animations** — spawn morph, working glow, etc. are CSS keyframes (these are fine, keep them)

---

## Current State

### How Positions Work Now

```
User drags node → pointerMove fires → canvas.moveInstance(id, x, y)
  → setStore("instances", ..., { positionX: x, positionY: y })
  → Solid.js reactivity updates inline style: left/top
  → No interpolation, no easing, no physics
```

- Positions stored as `positionX` / `positionY` in the Solid.js store
- Rendered via inline `left` / `top` on absolutely-positioned divs
- Backend PATCH persists position on drag end
- Spawn placement uses parent position + random offset
- No collision detection, no repulsion, no gravity

### What Causes Jank

1. **No interpolation** — position snaps instantly to new values
2. **Store reactivity in tight loop** — every `pointerMove` triggers reactive updates
3. **Integer pixels** — `Math.max(0, newX)` with no sub-pixel rendering
4. **No velocity/momentum** — drag stops = node stops dead
5. **Spawn overlaps** — new nodes can land on top of existing ones

---

## Target Feel (amcharts Force-Directed Reference)

The amcharts demo has these characteristics:

- **Springy connections** — parent-child links act like springs, pulling connected nodes toward an ideal distance
- **Node repulsion** — all nodes repel each other to prevent overlap, with force proportional to 1/distance²
- **Gentle gravity** — slight pull toward canvas center prevents nodes from drifting off-screen
- **Velocity + damping** — nodes have momentum. When released from a drag, they coast and settle. Damping (friction) gradually slows movement
- **Smooth continuous simulation** — physics runs every frame via `requestAnimationFrame`, not on-demand
- **Organic initial layout** — nodes find their own positions through simulation, not manual placement
- **Drag interaction** — dragging a node pins it, connected nodes follow via spring forces. Release = node floats back or stays
- **Warm start** — simulation starts hot (high alpha) and cools down as nodes settle

---

## Design

### Physics Engine (new: `canvas-physics.ts`)

A lightweight force-directed simulation running in `requestAnimationFrame`:

```typescript
type PhysicsNode = {
  id: string
  x: number
  y: number
  vx: number        // velocity X
  vy: number        // velocity Y
  fx: number | null  // fixed X (when dragging)
  fy: number | null  // fixed Y (when dragging)
  radius: number     // collision radius (36px for agent nodes)
  mass: number       // affects force response (1.0 default)
}

type PhysicsLink = {
  source: string  // instance ID
  target: string  // instance ID
  distance: number  // ideal spring length
  strength: number  // spring stiffness
}

type PhysicsConfig = {
  // Force strengths
  repulsionStrength: number    // default: -300 (negative = repel)
  linkStrength: number         // default: 0.3
  linkDistance: number          // default: 150px
  gravityStrength: number      // default: 0.02
  gravityCenter: { x: number; y: number }

  // Simulation parameters
  alpha: number                // current "temperature" (1.0 = hot, 0 = frozen)
  alphaDecay: number           // how fast simulation cools (default: 0.02)
  alphaMin: number             // stop simulating below this (default: 0.001)
  velocityDecay: number        // friction/damping (default: 0.4, 0 = no friction, 1 = no momentum)
}
```

### Force Calculations (per tick)

Each `requestAnimationFrame` tick applies forces in this order:

1. **Repulsion (charge force)** — all-pairs repulsion using Barnes-Hut approximation for performance:
   ```
   For each pair (A, B):
     dx = B.x - A.x
     dy = B.y - A.y
     dist = sqrt(dx² + dy²)
     force = repulsionStrength / dist²
     A.vx -= force * dx/dist * alpha
     A.vy -= force * dy/dist * alpha
   ```

2. **Link springs** — connected nodes pulled toward ideal distance:
   ```
   For each link (source → target):
     dx = target.x - source.x
     dy = target.y - source.y
     dist = sqrt(dx² + dy²)
     displacement = dist - link.distance
     force = displacement * link.strength * alpha
     // Split force between source and target
   ```

3. **Center gravity** — gentle pull toward canvas center:
   ```
   For each node:
     dx = center.x - node.x
     dy = center.y - node.y
     node.vx += dx * gravityStrength * alpha
     node.vy += dy * gravityStrength * alpha
   ```

4. **Velocity integration + damping**:
   ```
   For each node:
     if (node.fx !== null) { node.x = node.fx; node.vx = 0 }
     else { node.vx *= (1 - velocityDecay); node.x += node.vx }
     // Same for Y
   ```

5. **Alpha decay** — simulation cools over time:
   ```
   alpha = max(alphaMin, alpha - alphaDecay)
   if (alpha <= alphaMin) stop RAF loop
   ```

### Integration with Solid.js Store

The physics engine runs **outside** the Solid.js reactive system to avoid triggering re-renders 60 times per second:

```typescript
// Physics engine writes positions to a Float64Array (shared buffer)
// A batched updater syncs to the Solid.js store at a throttled rate

class CanvasPhysics {
  private nodes: Map<string, PhysicsNode> = new Map()
  private links: PhysicsLink[] = []
  private rafId: number | null = null
  private config: PhysicsConfig

  // Called by Solid.js store to sync positions back
  // Throttled to ~30fps for DOM updates (physics runs at 60fps internally)
  syncToStore(setStore: SetStoreFunction<CanvasStore>) {
    batch(() => {
      for (const [id, node] of this.nodes) {
        setStore(
          "instances",
          (inst) => inst.id === id,
          "positionX", Math.round(node.x),
        )
        setStore(
          "instances",
          (inst) => inst.id === id,
          "positionY", Math.round(node.y),
        )
      }
    })
  }
}
```

Key: Use Solid.js `batch()` to coalesce all position updates into a single reactive flush.

### Rendering: CSS `transform` Instead of `left`/`top`

Switch from `left`/`top` to `transform: translate3d()` for GPU-accelerated positioning:

```tsx
// Before (triggers layout):
<div style={{ left: `${posX}px`, top: `${posY}px` }}>

// After (GPU composited, no layout thrash):
<div style={{ transform: `translate3d(${posX}px, ${posY}px, 0)` }}>
```

This alone eliminates a huge source of jank — `left`/`top` triggers layout recalculation, `transform` doesn't.

---

## Spawn Animation Upgrade

### Current
Spawn uses CSS keyframes: scale 0 → overshoot 1.06 → settle. Node appears at a random offset from parent. No physics integration.

### New Behavior

1. **Physics-driven entrance** — new node starts at parent's position with initial velocity pushing it outward
2. **Spring tension** — the parent-child link spring pulls it to the ideal distance
3. **Other nodes repel** — the new node pushes existing nodes aside as it settles
4. **Alpha reheat** — spawning a node reheats the simulation (bumps alpha back up) so all nodes readjust

```typescript
function spawnNode(parentID: string, newNode: PhysicsNode) {
  const parent = this.nodes.get(parentID)
  if (parent) {
    // Start at parent position
    newNode.x = parent.x
    newNode.y = parent.y
    // Initial velocity: random direction, outward push
    const angle = Math.random() * Math.PI * 2
    const speed = 5
    newNode.vx = Math.cos(angle) * speed
    newNode.vy = Math.sin(angle) * speed
  }
  this.nodes.set(newNode.id, newNode)
  // Reheat simulation
  this.config.alpha = Math.max(this.config.alpha, 0.3)
  this.start()
}
```

Keep the CSS liquid morph animation (it's visually nice) but layer it on top of the physics-driven position.

---

## Drag Interaction

### Current
`pointerMove` → direct store mutation → no momentum on release.

### New Behavior

1. **Drag start** — pin the node (`fx = x, fy = y`), reheat simulation slightly
2. **Drag move** — update `fx, fy` directly (physics engine moves connected nodes via springs)
3. **Drag end** — unpin (`fx = null, fy = null`), node has zero velocity (or optional: inherit pointer velocity for a throw effect)
4. **Connected nodes follow** — while dragging, linked nodes are pulled along by spring forces, creating a satisfying organic drag feel

```typescript
function startDrag(id: string, x: number, y: number) {
  const node = this.nodes.get(id)
  if (node) {
    node.fx = x
    node.fy = y
    this.config.alpha = Math.max(this.config.alpha, 0.1) // gentle reheat
    this.start()
  }
}

function drag(id: string, x: number, y: number) {
  const node = this.nodes.get(id)
  if (node) { node.fx = x; node.fy = y }
}

function endDrag(id: string) {
  const node = this.nodes.get(id)
  if (node) { node.fx = null; node.fy = null }
  // Persist final position to backend after simulation settles
}
```

---

## Connection Line Animation

### Current
SVG lines with `animateMotion` message pulses. Static start/end points.

### New Behavior

- **Spring visualization** — connection lines could have a slight curve or wobble proportional to the spring force (optional, adds character)
- **Smooth endpoint updates** — since positions update smoothly via physics, lines automatically animate smoothly
- **Keep message pulses** — the existing `animateMotion` SVG pulses along connections are good

---

## Performance Considerations

### Barnes-Hut for Repulsion
For N nodes, naive all-pairs repulsion is O(N²). With 20+ agents this could lag. **Barnes-Hut approximation** (quadtree) reduces to O(N log N). For <50 nodes, naive is fine — BH is a future optimization.

### DOM Update Throttling
Physics runs at 60fps internally but DOM updates are throttled to **30fps** via `syncToStore`. This prevents Solid.js from re-rendering too frequently while keeping physics smooth.

### RAF Management
The physics loop auto-stops when `alpha < alphaMin` (simulation has settled). It restarts on:
- Node spawn
- Drag start
- Resize / viewport change
- Link added/removed

This means zero CPU usage when the canvas is at rest.

---

## Implementation Checklist

### New File: `canvas-physics.ts`
- [ ] `PhysicsNode`, `PhysicsLink`, `PhysicsConfig` types
- [ ] `CanvasPhysics` class with:
  - `addNode()`, `removeNode()`, `updateNode()`
  - `addLink()`, `removeLink()`
  - `start()`, `stop()`, `tick()`
  - `startDrag()`, `drag()`, `endDrag()`
  - `syncToStore()` with `batch()` coalescing
- [ ] Force calculations: repulsion, link springs, center gravity
- [ ] Alpha decay + auto-stop when settled
- [ ] Collision radius enforcement (prevent node overlap)

### Canvas Context (`canvas.tsx`)
- [ ] Initialize `CanvasPhysics` instance
- [ ] Feed instances and connections into physics on load
- [ ] Bridge physics ↔ store: physics writes positions, store reads them
- [ ] `moveInstance()` → delegates to physics `drag()` during drag, `endDrag()` on release
- [ ] Spawn: call physics `spawnNode()` instead of random offset
- [ ] Persist positions to backend only on drag end + simulation settle

### Agent Canvas (`agent-canvas.tsx`)
- [ ] Replace `handlePointerMove` drag logic to use `physics.drag()` instead of `canvas.moveInstance()`
- [ ] Replace `handlePointerUp` to call `physics.endDrag()`
- [ ] Remove direct store position mutation during drag

### Agent Node (`agent-node.tsx`)
- [ ] Switch from `left`/`top` to `transform: translate3d()` for positioning
- [ ] Keep all existing CSS state animations (working, error, question, spawn)
- [ ] Spawn animation: layer CSS morph on top of physics-driven position

### Agent Connection (`agent-connection.tsx`)
- [ ] Lines already use reactive coordinates — should animate smoothly with physics
- [ ] Optional: add slight spring curve to connection lines

### CSS (`agent-canvas.css`)
- [ ] Update `.agent-node` positioning from `position: absolute; left; top` to `position: absolute; transform`
- [ ] Add `will-change: transform` for GPU compositing hint
- [ ] Keep all existing keyframe animations

---

## Physics Config Defaults

```typescript
const DEFAULT_CONFIG: PhysicsConfig = {
  repulsionStrength: -300,    // Negative = repel
  linkStrength: 0.3,          // Spring stiffness
  linkDistance: 150,           // Ideal distance between connected nodes (px)
  gravityStrength: 0.02,      // Pull toward center
  gravityCenter: { x: 400, y: 300 },  // Updated on resize

  alpha: 1.0,                 // Start hot
  alphaDecay: 0.02,           // Cool rate
  alphaMin: 0.001,            // Stop threshold
  velocityDecay: 0.4,         // Friction (0.4 = moderate damping)
}
```

These can be tuned visually. The amcharts feel is:
- **Moderate damping** (0.3–0.5) — nodes glide but don't oscillate forever
- **Strong repulsion** — nodes push away firmly, no overlap
- **Soft springs** — connections stretch and compress, feel elastic
- **Light gravity** — keeps things centered without feeling constrained

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/components/canvas/canvas-physics.ts` | **New** — force-directed physics engine |
| `packages/app/src/context/canvas.tsx` | Initialize physics, bridge store ↔ physics |
| `packages/app/src/components/canvas/agent-canvas.tsx` | Delegate drag to physics, remove direct store mutations |
| `packages/app/src/components/canvas/agent-node.tsx` | Switch to `transform: translate3d()` |
| `packages/app/src/components/canvas/agent-canvas.css` | Update positioning model, add `will-change` |

---

## Open Questions

1. **Should physics run always or only on interaction?** Start hot on page load to find initial layout, then auto-stop. Reheat on spawn/drag/resize. Zero CPU at rest.
2. **Persist physics positions?** Yes — on simulation settle, batch-persist positions to backend. During active simulation, don't flood the backend with PATCHes.
3. **User manually positioned nodes?** After dragging, the node stays where released (physics respects the final position). Only spawns + connections use auto-layout.
4. **Zoom/pan interaction?** Physics operates in canvas-space coordinates. Zoom/pan is purely a viewport transform — physics is unaffected.
5. **Group chat centroid node?** The centroid acts as a physics node too — connected to all group members via springs. This creates the natural cluster layout automatically.
