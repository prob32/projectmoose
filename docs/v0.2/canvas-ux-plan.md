# Canvas UX Improvements

## Overview

Add zoom/pan controls, a minimap overview widget, and optional snap-to-grid to make the canvas navigable at any scale.

---

## Current State

- **Viewport state exists** — `canvas.tsx` has `viewport: { x: number; y: number; scale: number }` in the store, initialized to `{ x: 0, y: 0, scale: 1 }`, but **nothing reads or writes it**
- **No zoom** — no wheel event handler, no pinch gesture support
- **No pan** — canvas background click does nothing for panning; only node drag exists
- **No minimap** — no overview widget
- **Node positioning** — nodes use absolute `left`/`top` in canvas space (will become `transform: translate3d` after physics plan)

---

## Design: Zoom & Pan

### Wheel Zoom

Scroll wheel on the canvas zooms in/out centered on the cursor position:

```typescript
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = -e.deltaY * 0.001
  const newScale = Math.max(0.2, Math.min(3, canvas.viewport.scale + delta))

  // Zoom toward cursor position
  const rect = canvasRef.getBoundingClientRect()
  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top

  // Adjust viewport offset so the point under cursor stays fixed
  const scaleRatio = newScale / canvas.viewport.scale
  const newX = cursorX - (cursorX - canvas.viewport.x) * scaleRatio
  const newY = cursorY - (cursorY - canvas.viewport.y) * scaleRatio

  setStore("viewport", { x: newX, y: newY, scale: newScale })
}
```

Scale range: **0.2x to 3x** (20% to 300%).

### Canvas Transform

Apply viewport transform to a wrapper div that contains all nodes and the SVG layer:

```tsx
<div
  class="agent-canvas-viewport"
  style={{
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
    "transform-origin": "0 0",
  }}
>
  {/* SVG connections + agent nodes inside here */}
</div>
```

The outer `.agent-canvas` div handles events (wheel, pointer). The inner viewport div gets transformed.

### Middle-Click Pan

Middle mouse button (or Ctrl+left-click) drags the viewport:

```typescript
function handleCanvasPointerDown(e: PointerEvent) {
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
    // Start panning
    panStart = { x: e.clientX - canvas.viewport.x, y: e.clientY - canvas.viewport.y }
    canvasRef.setPointerCapture(e.pointerId)
  }
}
```

### Zoom Controls Widget

Floating controls in the bottom-left corner:

```
┌─────────────────┐
│  [+]  100%  [-] │
│  [⟐ Fit View]   │
└─────────────────┘
```

- `+` / `-` — zoom in/out by 0.25x steps
- Percentage display — shows current zoom level
- `Fit View` — calculates bounding box of all nodes and adjusts viewport to show them all with padding

### Fit-to-View Calculation

```typescript
function fitView() {
  if (canvas.instances.length === 0) return
  const padding = 80

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const inst of canvas.instances) {
    minX = Math.min(minX, inst.positionX)
    minY = Math.min(minY, inst.positionY)
    maxX = Math.max(maxX, inst.positionX + 72) // node width
    maxY = Math.max(maxY, inst.positionY + 100) // node height + label
  }

  const width = maxX - minX + padding * 2
  const height = maxY - minY + padding * 2
  const rect = canvasRef.getBoundingClientRect()
  const scale = Math.min(rect.width / width, rect.height / height, 2) // cap at 2x

  setStore("viewport", {
    x: (rect.width - width * scale) / 2 - minX * scale + padding * scale,
    y: (rect.height - height * scale) / 2 - minY * scale + padding * scale,
    scale,
  })
}
```

### Keyboard Shortcuts

- `Ctrl + =` — zoom in
- `Ctrl + -` — zoom out
- `Ctrl + 0` — reset to 100%
- `Ctrl + Shift + F` — fit to view

---

## Design: Minimap

A small overview panel in the bottom-right corner showing all nodes as colored dots with a viewport rectangle.

### Layout

```
┌──────────────────────────────────────────┐
│                   Canvas                 │
│                                          │
│                                          │
│                                          │
│                       ┌──────────┐       │
│                       │ ●  ●     │       │
│                       │    ●  ●  │       │
│                       │  ●       │       │
│                       └──────────┘       │
└──────────────────────────────────────────┘
```

### Component: `canvas-minimap.tsx`

```tsx
function CanvasMinimap() {
  const canvas = useCanvas()
  const MINIMAP_W = 160
  const MINIMAP_H = 100

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

  // Map world coords → minimap coords
  const toMinimap = (wx: number, wy: number) => {
    const b = bounds()
    const worldW = b.maxX - b.minX
    const worldH = b.maxY - b.minY
    return {
      x: ((wx - b.minX) / worldW) * MINIMAP_W,
      y: ((wy - b.minY) / worldH) * MINIMAP_H,
    }
  }

  return (
    <div class="canvas-minimap">
      <svg width={MINIMAP_W} height={MINIMAP_H}>
        {/* Viewport rectangle */}
        {/* ... computed from canvas.viewport and container size */}

        {/* Node dots */}
        <For each={canvas.instances}>
          {(inst) => {
            const pos = () => toMinimap(inst.positionX, inst.positionY)
            const def = () => canvas.definitionFor(inst)
            return <circle cx={pos().x} cy={pos().y} r={3} fill={def()?.color ?? "#888"} />
          }}
        </For>

        {/* Connection lines */}
        <For each={canvas.connections()}>
          {(conn) => {
            const p1 = () => toMinimap(conn.parent.positionX, conn.parent.positionY)
            const p2 = () => toMinimap(conn.child.positionX, conn.child.positionY)
            return <line x1={p1().x} y1={p1().y} x2={p2().x} y2={p2().y} stroke="rgba(139,92,246,0.3)" stroke-width={0.5} />
          }}
        </For>
      </svg>
    </div>
  )
}
```

### Minimap Interactions

- **Click on minimap** → center the viewport on that world position
- **Drag the viewport rectangle** → pan the canvas
- **Toggle visibility** — small eye icon to hide/show the minimap

---

## Design: Snap-to-Grid (Optional)

A toggleable mode where nodes snap to a grid when dragged or positioned by physics.

### Grid Size

Default: 24px (matches the existing dot grid pattern in CSS).

### Implementation

In the physics engine (`canvas-physics.ts`), after computing final positions, optionally round to grid:

```typescript
if (config.snapToGrid) {
  node.x = Math.round(node.x / config.gridSize) * config.gridSize
  node.y = Math.round(node.y / config.gridSize) * config.gridSize
}
```

For manual drag, snap on pointer up:

```typescript
function handlePointerUp() {
  if (canvas.viewport.snapToGrid) {
    const snappedX = Math.round(pos.x / 24) * 24
    const snappedY = Math.round(pos.y / 24) * 24
    canvas.moveInstance(id, snappedX, snappedY)
  }
}
```

### Toggle

Small toggle in the zoom controls widget: `[⊞ Grid]` — toggles snap mode on/off.

---

## Design: Node Resize by State

Working nodes grow slightly, idle nodes shrink back. Creates a visual breathing effect.

### CSS-Only Approach

Already partially implemented — `.state-working` has `agent-working-breathe` animation that scales to 1.03. Enhance this:

```css
/* Working nodes: slightly larger persistent scale */
.agent-node.state-working {
  transform: scale(1.05);
}

/* Idle nodes: normal scale */
.agent-node {
  transition: transform 0.3s ease;
}
```

This is mostly covered by the existing CSS animations. The physics plan's switch to `transform: translate3d` will need to compose scale with translation.

---

## Implementation Checklist

### Zoom & Pan
- [ ] Add `onWheel` handler to `.agent-canvas` for scroll zoom
- [ ] Add viewport transform wrapper div inside canvas
- [ ] Implement middle-click pan (pointer events)
- [ ] Add Ctrl+click pan alternative
- [ ] Zoom controls widget component (bottom-left)
- [ ] Fit-to-view calculation + button
- [ ] Keyboard shortcuts (Ctrl+=, Ctrl+-, Ctrl+0, Ctrl+Shift+F)
- [ ] Persist viewport state across page navigations

### Minimap
- [ ] `canvas-minimap.tsx` component
- [ ] World-to-minimap coordinate mapping
- [ ] Render node dots with definition colors
- [ ] Render connection lines (thin, dim)
- [ ] Viewport rectangle overlay
- [ ] Click-to-navigate on minimap
- [ ] Drag viewport rectangle to pan
- [ ] Toggle visibility button

### Snap-to-Grid
- [ ] Add `snapToGrid` toggle to canvas store
- [ ] Snap logic in physics engine's position output
- [ ] Snap logic on drag end for manual positioning
- [ ] Visual toggle in zoom controls widget

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/components/canvas/agent-canvas.tsx` | Add wheel/pan handlers, viewport transform wrapper |
| `packages/app/src/components/canvas/canvas-minimap.tsx` | **New** — minimap component |
| `packages/app/src/components/canvas/canvas-zoom-controls.tsx` | **New** — zoom controls widget |
| `packages/app/src/components/canvas/agent-canvas.css` | Viewport wrapper styles, minimap styles, zoom controls styles |
| `packages/app/src/context/canvas.tsx` | Add `setViewport()`, `snapToGrid` to store |
| `packages/app/src/components/canvas/canvas-physics.ts` | Snap-to-grid in position output (after physics plan) |
