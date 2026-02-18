import { type Component, For, Show, createMemo, createSignal } from "solid-js"
import { useCanvas } from "@/context/canvas"

const MINIMAP_W = 160
const MINIMAP_H = 100

export type CanvasMinimapProps = {
  canvasRef: HTMLDivElement | undefined
}

export const CanvasMinimap: Component<CanvasMinimapProps> = (props) => {
  const canvas = useCanvas()
  const [visible, setVisible] = createSignal(true)

  // Compute world bounds from all instance positions
  const bounds = createMemo(() => {
    if (canvas.instances.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const inst of canvas.instances) {
      minX = Math.min(minX, inst.positionX)
      minY = Math.min(minY, inst.positionY)
      maxX = Math.max(maxX, inst.positionX + 72)
      maxY = Math.max(maxY, inst.positionY + 100)
    }
    const pad = 100
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  })

  // Map world coords to minimap coords
  function toMinimap(wx: number, wy: number) {
    const b = bounds()
    const worldW = b.maxX - b.minX || 1
    const worldH = b.maxY - b.minY || 1
    return {
      x: ((wx - b.minX) / worldW) * MINIMAP_W,
      y: ((wy - b.minY) / worldH) * MINIMAP_H,
    }
  }

  // Viewport rectangle in minimap coords
  const viewportRect = createMemo(() => {
    if (!props.canvasRef) return { x: 0, y: 0, w: MINIMAP_W, h: MINIMAP_H }
    const rect = props.canvasRef.getBoundingClientRect()
    const scale = canvas.viewport.scale || 1
    const b = bounds()
    const worldW = b.maxX - b.minX || 1
    const worldH = b.maxY - b.minY || 1

    // Visible area in world coords
    const visX = (-canvas.viewport.x / scale)
    const visY = (-canvas.viewport.y / scale)
    const visW = rect.width / scale
    const visH = rect.height / scale

    return {
      x: ((visX - b.minX) / worldW) * MINIMAP_W,
      y: ((visY - b.minY) / worldH) * MINIMAP_H,
      w: (visW / worldW) * MINIMAP_W,
      h: (visH / worldH) * MINIMAP_H,
    }
  })

  // Click on minimap to navigate
  function handleMinimapClick(e: MouseEvent) {
    if (!props.canvasRef) return
    const target = e.currentTarget as SVGSVGElement
    const rect = target.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // Convert minimap coords to world coords
    const b = bounds()
    const worldW = b.maxX - b.minX || 1
    const worldH = b.maxY - b.minY || 1
    const worldX = (mx / MINIMAP_W) * worldW + b.minX
    const worldY = (my / MINIMAP_H) * worldH + b.minY

    // Center the viewport on this world position
    const containerRect = props.canvasRef.getBoundingClientRect()
    const scale = canvas.viewport.scale || 1
    canvas.setViewport({
      x: containerRect.width / 2 - worldX * scale,
      y: containerRect.height / 2 - worldY * scale,
    })
  }

  return (
    <div class="canvas-minimap-container">
      <button
        class="minimap-toggle"
        onClick={() => setVisible(!visible())}
        title={visible() ? "Hide minimap" : "Show minimap"}
      >
        {visible() ? "\u25BC" : "\u25B2"}
      </button>
      <Show when={visible() && canvas.instances.length > 0}>
        <div class="canvas-minimap">
          <svg
            width={MINIMAP_W}
            height={MINIMAP_H}
            onClick={handleMinimapClick}
            style={{ cursor: "crosshair" }}
          >
            {/* Background */}
            <rect width={MINIMAP_W} height={MINIMAP_H} fill="rgba(15, 13, 26, 0.6)" rx="4" />

            {/* Connection lines */}
            <For each={canvas.connections()}>
              {(conn) => {
                const p1 = () => toMinimap(conn.parent.positionX + 36, conn.parent.positionY + 36)
                const p2 = () => toMinimap(conn.child.positionX + 36, conn.child.positionY + 36)
                return (
                  <line
                    x1={p1().x} y1={p1().y}
                    x2={p2().x} y2={p2().y}
                    stroke="rgba(139,92,246,0.3)"
                    stroke-width={0.5}
                  />
                )
              }}
            </For>

            {/* Node dots */}
            <For each={canvas.instances}>
              {(inst) => {
                const pos = () => toMinimap(inst.positionX + 36, inst.positionY + 36)
                const def = () => canvas.definitionFor(inst)
                return (
                  <circle
                    cx={pos().x}
                    cy={pos().y}
                    r={3}
                    fill={def()?.color ?? "#888"}
                    opacity={inst.state === "working" ? 1 : 0.7}
                  />
                )
              }}
            </For>

            {/* Viewport rectangle */}
            <rect
              x={viewportRect().x}
              y={viewportRect().y}
              width={viewportRect().w}
              height={viewportRect().h}
              fill="none"
              stroke="rgba(139,92,246,0.5)"
              stroke-width={1}
              rx={2}
            />
          </svg>
        </div>
      </Show>
    </div>
  )
}
