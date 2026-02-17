import { type Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useCanvas } from "@/context/canvas"
import { useSync } from "@/context/sync"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { AgentNode } from "./agent-node"
import { AgentConnection } from "./agent-connection"
import { ActiveInstancesOverlay } from "./active-instances-overlay"
import { CanvasContextMenu } from "./canvas-context-menu"
import { AgentNodeContextMenu } from "./agent-node-context-menu"
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

  // ===== Drag handling =====
  const [dragPos, setDragPos] = createSignal<{ x: number; y: number } | undefined>()

  function handlePointerDown(instanceID: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const instance = canvas.instances.find((i) => i.id === instanceID)
    if (!instance) return

    const offsetX = e.clientX - instance.positionX
    const offsetY = e.clientY - instance.positionY
    canvas.startDrag(instanceID, offsetX, offsetY)
    canvas.select(instanceID)

    // Capture pointer for drag
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent) {
    const dragging = canvas.draggingID
    if (!dragging) return

    const newX = e.clientX - canvas.dragOffset.x
    const newY = e.clientY - canvas.dragOffset.y

    // Optimistic local position update during drag
    canvas.moveInstance(dragging, Math.max(0, newX), Math.max(0, newY))
  }

  function handlePointerUp(_e: PointerEvent) {
    const dragging = canvas.draggingID
    if (!dragging) return

    const instance = canvas.instances.find((i) => i.id === dragging)
    if (instance) {
      // Final position is already set via moveInstance (optimistic + API call)
    }

    canvas.stopDrag()
  }

  // ===== Context menu =====
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    if (!canvasRef) return

    const rect = canvasRef.getBoundingClientRect()
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top

    canvas.closeNodeContextMenu()
    canvas.openContextMenu(e.clientX, e.clientY, canvasX, canvasY)
  }

  // ===== Click on empty canvas to deselect =====
  function handleCanvasClick(e: MouseEvent) {
    // Only deselect if clicking directly on the canvas background
    if (e.target === canvasRef || (e.target as HTMLElement).tagName === "svg") {
      canvas.deselect()
      canvas.closeContextMenu()
      canvas.closeNodeContextMenu()
    }
  }

  // ===== Keyboard shortcuts =====
  function handleKeyDown(e: KeyboardEvent) {
    // Don't handle Delete/Backspace when user is typing in an input field
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
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
  })

  return (
    <div
      ref={canvasRef}
      class="agent-canvas"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onClick={handleCanvasClick}
    >
      {/* SVG layer for connection lines */}
      <svg
        style={{
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          "pointer-events": "none",
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

      {/* Empty state */}
      <Show when={canvas.instances.length === 0}>
        <div class="canvas-empty">
          <div class="canvas-empty-icon">
            <BullMooseIcon size={64} color="#8b5cf6" />
          </div>
          <div class="canvas-empty-text">Right-click to add an agent</div>
          <div class="canvas-empty-hint">or use the sidebar to manage agent types</div>
        </div>
      </Show>

      {/* Floating active-instances overlay (top-right) */}
      <ActiveInstancesOverlay />

      {/* Context menus */}
      <CanvasContextMenu workspaceSessionID={props.workspaceSessionID} />
      <AgentNodeContextMenu workspaceSessionID={props.workspaceSessionID} />
    </div>
  )
}
