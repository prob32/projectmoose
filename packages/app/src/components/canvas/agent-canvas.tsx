import { type Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useCanvas } from "@/context/canvas"
import { useSync } from "@/context/sync"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { AgentNode } from "./agent-node"
import { AgentConnection } from "./agent-connection"
import { ActiveInstancesOverlay } from "./active-instances-overlay"
import { CanvasContextMenu } from "./canvas-context-menu"
import { AgentNodeContextMenu } from "./agent-node-context-menu"
import { CanvasZoomControls } from "./canvas-zoom-controls"
import { CanvasMinimap } from "./canvas-minimap"
import { BullMooseIcon } from "./moose-icons"
import "./agent-canvas.css"

const NODE_CENTER = 36 // half of the 72px node diameter

export type AgentCanvasProps = {
  workspaceSessionID: string
}

export const AgentCanvas: Component<AgentCanvasProps> = (props) => {
  const canvas = useCanvas()
  const sync = useSync()

  /** Compute context usage percentage for each instance (keyed by instance ID) */
  const contextUsageMap = createMemo(() => {
    const map: Record<string, number> = {}
    for (const inst of canvas.instances) {
      if (!inst.sessionID) continue
      const messages = sync.data.message[inst.sessionID] ?? []
      if (messages.length === 0) continue
      const metrics = getSessionContextMetrics(messages, sync.data.provider.all)
      if (metrics.context?.usage != null) {
        map[inst.id] = metrics.context.usage
      }
    }
    return map
  })

  /** Compute todo progress for each instance (keyed by instance ID) */
  const todoProgressMap = createMemo(() => {
    const result: Record<string, { completed: number; total: number }> = {}
    for (const inst of canvas.instances) {
      if (!inst.sessionID) continue
      const todos = sync.data.todo[inst.sessionID]
      if (!todos?.length) continue
      const completed = todos.filter((t) => t.status === "completed").length
      result[inst.id] = { completed, total: todos.length }
    }
    return result
  })

  // Eagerly load todo data for all agent instances with sessions
  createEffect(() => {
    for (const inst of canvas.instances) {
      if (inst.sessionID) {
        sync.session.todo(inst.sessionID)
      }
    }
  })

  let canvasRef: HTMLDivElement | undefined

  // Load data when workspace session changes
  createEffect(() => {
    const wsid = props.workspaceSessionID
    if (!wsid) return
    canvas.fetchDefinitions()
    canvas.fetchInstances(wsid)
  })

  // Update physics gravity center when canvas resizes
  onMount(() => {
    if (!canvasRef) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        canvas.physics.setGravityCenter(width / 2, height / 2)
      }
    })
    observer.observe(canvasRef)
    onCleanup(() => observer.disconnect())
  })

  // ===== Panning State =====
  const [isPanning, setIsPanning] = createSignal(false)
  const [panStart, setPanStart] = createSignal<{ x: number; y: number } | undefined>()

  // ===== Wheel Zoom =====
  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    if (!canvasRef) return

    const delta = -e.deltaY * 0.001
    const oldScale = canvas.viewport.scale
    const newScale = Math.max(0.2, Math.min(3, oldScale + delta))

    // Zoom toward cursor position
    const rect = canvasRef.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top

    // Adjust viewport offset so the point under cursor stays fixed
    const scaleRatio = newScale / oldScale
    const newX = cursorX - (cursorX - canvas.viewport.x) * scaleRatio
    const newY = cursorY - (cursorY - canvas.viewport.y) * scaleRatio

    canvas.setViewport({ x: newX, y: newY, scale: newScale })
  }

  // ===== Drag + Pan handling =====
  function handlePointerDown(instanceID: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const instance = canvas.instances.find((i) => i.id === instanceID)
    if (!instance) return

    const offsetX = e.clientX - instance.positionX
    const offsetY = e.clientY - instance.positionY
    canvas.startDrag(instanceID, offsetX, offsetY)
    canvas.select(instanceID)

    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function handleCanvasPointerDown(e: PointerEvent) {
    // Middle-click pan or Ctrl+left-click pan
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX - canvas.viewport.x, y: e.clientY - canvas.viewport.y })
      canvasRef?.setPointerCapture(e.pointerId)
    }
  }

  function handlePointerMove(e: PointerEvent) {
    // Canvas panning
    if (isPanning()) {
      const start = panStart()
      if (start) {
        canvas.setViewport({
          x: e.clientX - start.x,
          y: e.clientY - start.y,
        })
      }
      return
    }

    // Node dragging — delegate to physics engine for organic connected-node movement
    const dragging = canvas.draggingID
    if (dragging) {
      const rect = canvasRef?.getBoundingClientRect()
      const scale = canvas.viewport.scale || 1
      const canvasX = rect ? (e.clientX - rect.left - canvas.viewport.x) / scale : e.clientX - canvas.dragOffset.x
      const canvasY = rect ? (e.clientY - rect.top - canvas.viewport.y) / scale : e.clientY - canvas.dragOffset.y
      canvas.dragMove(dragging, canvasX, canvasY)
      return
    }
  }

  function handlePointerUp(_e: PointerEvent) {
    // Finish panning
    if (isPanning()) {
      setIsPanning(false)
      setPanStart(undefined)
      return
    }

    // Finish node drag
    const dragging = canvas.draggingID
    if (dragging) {
      canvas.stopDrag()
      return
    }
  }

  // ===== Context menu =====
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    if (!canvasRef) return

    const rect = canvasRef.getBoundingClientRect()
    const scale = canvas.viewport.scale || 1
    // Convert screen position to canvas-space for spawn placement
    const canvasX = (e.clientX - rect.left - canvas.viewport.x) / scale
    const canvasY = (e.clientY - rect.top - canvas.viewport.y) / scale

    canvas.closeNodeContextMenu()
    canvas.openContextMenu(e.clientX, e.clientY, canvasX, canvasY)
  }

  // ===== Click on empty canvas to deselect =====
  function handleCanvasClick(e: MouseEvent) {
    if (e.target === canvasRef || (e.target as HTMLElement).classList.contains("agent-canvas-viewport") || (e.target as HTMLElement).tagName === "svg") {
      canvas.deselect()
      canvas.closeContextMenu()
      canvas.closeNodeContextMenu()
    }
  }

  // ===== Keyboard shortcuts =====
  function handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    const isEditable =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.contentEditable === "true" ||
      !!target.closest?.("[contenteditable]")

    if (e.key === "Escape") {
      canvas.deselect()
      canvas.closeContextMenu()
      canvas.closeNodeContextMenu()
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (isEditable) return
      const selected = canvas.selectedID
      if (selected) {
        canvas.removeInstance(selected)
        canvas.deselect()
      }
    }

    // Zoom shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        canvas.setViewport({ scale: Math.min(3, canvas.viewport.scale + 0.25) })
      } else if (e.key === "-") {
        e.preventDefault()
        canvas.setViewport({ scale: Math.max(0.2, canvas.viewport.scale - 0.25) })
      } else if (e.key === "0") {
        e.preventDefault()
        canvas.setViewport({ x: 0, y: 0, scale: 1 })
      }

      // Fit-to-view: Ctrl+Shift+F
      if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault()
        if (canvasRef) {
          const rect = canvasRef.getBoundingClientRect()
          canvas.fitView(rect.width, rect.height)
        }
      }
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))

    // Attach wheel handler with passive: false to allow preventDefault
    if (canvasRef) {
      canvasRef.addEventListener("wheel", handleWheel, { passive: false })
      onCleanup(() => canvasRef?.removeEventListener("wheel", handleWheel))
    }
  })

  return (
    <div
      ref={canvasRef}
      class="agent-canvas"
      classList={{ panning: isPanning() }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onClick={handleCanvasClick}
    >
      {/* Viewport transform wrapper — zoom/pan applied here */}
      <div
        class="agent-canvas-viewport"
        style={{
          transform: `translate(${canvas.viewport.x}px, ${canvas.viewport.y}px) scale(${canvas.viewport.scale})`,
        }}
      >
        {/* SVG layer for connection lines */}
        <svg
          style={{
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            "pointer-events": "none",
            overflow: "visible",
          }}
        >
          <For each={canvas.connections()}>
            {(conn) => (
              <AgentConnection
                parent={conn.parent}
                child={conn.child}
                active={canvas.selectedID === conn.parentID || canvas.selectedID === conn.childID}
                color={canvas.definitionFor(conn.parent)?.color}
                taskComplete={!!canvas.completedInstances[conn.childID]}
                recentMessages={canvas.agentMessages.filter(
                  (m) =>
                    (m.fromInstanceID === conn.parentID && m.toInstanceID === conn.childID) ||
                    (m.fromInstanceID === conn.childID && m.toInstanceID === conn.parentID),
                )}
              />
            )}
          </For>
        </svg>

        {/* Agent node layer */}
        <For each={canvas.instances}>
          {(instance) => (
            <AgentNode
              instance={instance}
              definition={canvas.definitionFor(instance)}
              selected={canvas.selectedID === instance.id}
              gcWarning={!!canvas.gcWarnings[instance.id]}
              taskComplete={!!canvas.completedInstances[instance.id]}
              contextUsage={contextUsageMap()[instance.id]}
              todoProgress={todoProgressMap()[instance.id]}
              onPointerDown={(e) => handlePointerDown(instance.id, e)}
              onClick={(e) => {
                e.stopPropagation()
                canvas.select(instance.id)
              }}
              onContextMenu={(e) => {
                e.stopPropagation()
                e.preventDefault()
                canvas.select(instance.id)
                canvas.openNodeContextMenu(instance.id, e.clientX, e.clientY)
              }}
            />
          )}
        </For>
      </div>

      {/* Empty state (outside viewport — doesn't zoom) */}
      <Show when={canvas.instances.length === 0}>
        <div class="canvas-empty">
          <div class="canvas-empty-icon">
            <BullMooseIcon size={64} color="#8b5cf6" />
          </div>
          <div class="canvas-empty-text">Right-click to add an agent</div>
          <div class="canvas-empty-hint">or use the sidebar to manage agent types</div>
        </div>
      </Show>

      {/* Floating overlays (outside viewport — don't zoom) */}
      <ActiveInstancesOverlay />
      <CanvasZoomControls canvasRef={canvasRef} />
      <CanvasMinimap canvasRef={canvasRef} />

      {/* Context menus */}
      <CanvasContextMenu workspaceSessionID={props.workspaceSessionID} />
      <AgentNodeContextMenu workspaceSessionID={props.workspaceSessionID} />
    </div>
  )
}
