import { type Component } from "solid-js"
import { useCanvas } from "@/context/canvas"

export type CanvasZoomControlsProps = {
  canvasRef: HTMLDivElement | undefined
}

export const CanvasZoomControls: Component<CanvasZoomControlsProps> = (props) => {
  const canvas = useCanvas()

  const zoomPercent = () => Math.round(canvas.viewport.scale * 100)

  function zoomIn() {
    canvas.setViewport({ scale: Math.min(3, canvas.viewport.scale + 0.25) })
  }

  function zoomOut() {
    canvas.setViewport({ scale: Math.max(0.2, canvas.viewport.scale - 0.25) })
  }

  function resetZoom() {
    canvas.setViewport({ x: 0, y: 0, scale: 1 })
  }

  function fitView() {
    if (!props.canvasRef) return
    const rect = props.canvasRef.getBoundingClientRect()
    canvas.fitView(rect.width, rect.height)
  }

  return (
    <div class="canvas-zoom-controls">
      <button class="zoom-btn" onClick={zoomIn} title="Zoom in (Ctrl+=)">+</button>
      <button class="zoom-percent" onClick={resetZoom} title="Reset zoom (Ctrl+0)">
        {zoomPercent()}%
      </button>
      <button class="zoom-btn" onClick={zoomOut} title="Zoom out (Ctrl+-)">-</button>
      <button class="zoom-btn zoom-fit" onClick={fitView} title="Fit to view (Ctrl+Shift+F)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" />
          <path d="M1 5H3M1 9H3M5 1V3M9 1V3M11 5H13M11 9H13M5 11V13M9 11V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  )
}
