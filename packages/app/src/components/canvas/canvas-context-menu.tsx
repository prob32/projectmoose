import { type Component, For, Show, createEffect, onCleanup } from "solid-js"
import { useCanvas, type AgentDefinitionInfo } from "@/context/canvas"

export type CanvasContextMenuProps = {
  workspaceSessionID: string
}

export const CanvasContextMenu: Component<CanvasContextMenuProps> = (props) => {
  const canvas = useCanvas()

  let menuRef: HTMLDivElement | undefined

  // Close context menu on outside click or Escape
  createEffect(() => {
    if (!canvas.contextMenu) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        canvas.closeContextMenu()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        canvas.closeContextMenu()
      }
    }

    // Delay to avoid catching the same contextmenu event
    const raf = requestAnimationFrame(() => {
      document.addEventListener("click", handleClick)
      document.addEventListener("contextmenu", handleClick)
      document.addEventListener("keydown", handleKeyDown)
    })

    onCleanup(() => {
      cancelAnimationFrame(raf)
      document.removeEventListener("click", handleClick)
      document.removeEventListener("contextmenu", handleClick)
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  async function handleAddAgent(definition: AgentDefinitionInfo) {
    const menu = canvas.contextMenu
    if (!menu) return

    await canvas.addInstance({
      workspaceSessionID: props.workspaceSessionID,
      agentDefinitionID: definition.id,
      positionX: menu.canvasX,
      positionY: menu.canvasY,
    })

    canvas.closeContextMenu()
  }

  return (
    <Show when={canvas.contextMenu}>
      {(menu) => (
        <div
          ref={menuRef}
          class="canvas-context-menu"
          style={{
            left: `${menu().x}px`,
            top: `${menu().y}px`,
          }}
        >
          <Show
            when={canvas.definitions.length > 0}
            fallback={
              <div class="canvas-context-menu-item" style={{ opacity: 0.5, cursor: "default" }}>
                No agent definitions configured
              </div>
            }
          >
            <div
              style={{
                padding: "6px 12px",
                "font-size": "11px",
                "font-weight": "600",
                color: "var(--text-weak)",
                "text-transform": "uppercase",
                "letter-spacing": "0.05em",
              }}
            >
              Add Agent
            </div>
            <For each={canvas.definitions}>
              {(definition) => (
                <button class="canvas-context-menu-item" onClick={() => handleAddAgent(definition)}>
                  <span class="agent-dot" style={{ background: definition.color }} />
                  <span>{definition.name}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      )}
    </Show>
  )
}
