import { type Component, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { useCanvas } from "@/context/canvas"
import { useSync } from "@/context/sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Icon } from "@opencode-ai/ui/icon"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { AgentEditDialog } from "@/components/agent-edit-dialog"
import { useSDK } from "@/context/sdk"
import { copyToClipboard } from "@/utils/clipboard"

export type AgentNodeContextMenuProps = {
  workspaceSessionID: string
}

export const AgentNodeContextMenu: Component<AgentNodeContextMenuProps> = (props) => {
  const canvas = useCanvas()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  let menuRef: HTMLDivElement | undefined

  // Close on outside click or Escape
  createEffect(() => {
    if (!canvas.nodeContextMenu) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        canvas.closeNodeContextMenu()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        canvas.closeNodeContextMenu()
      }
    }

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

  const instance = createMemo(() => {
    const menu = canvas.nodeContextMenu
    if (!menu) return undefined
    return canvas.instances.find((i) => i.id === menu.instanceID)
  })

  const definition = createMemo(() => {
    const inst = instance()
    if (!inst) return undefined
    return canvas.definitionFor(inst)
  })

  const messages = createMemo(() => {
    const inst = instance()
    if (!inst?.sessionID) return []
    return sync.data.message[inst.sessionID] ?? []
  })

  const metrics = createMemo(() => getSessionContextMetrics(messages(), sync.data.provider.all))
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => {
    const c = metrics().totalCost
    return c > 0 ? `$${c.toFixed(4)}` : undefined
  })

  const mcpServerNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort())
  const providers = createMemo(() => sync.data.provider.all ?? [])
  const connectedProviderIDs = createMemo(() => sync.data.provider.connected ?? [])

  function handleEditDefinition() {
    const def = definition()
    if (!def) return
    canvas.closeNodeContextMenu()
    dialog.show(
      () => (
        <AgentEditDialog
          existing={def}
          serverUrl={sdk.url}
          directory={sdk.directory}
          allDefinitions={[...canvas.definitions]}
          mcpServerNames={mcpServerNames()}
          providers={[...providers()]}
          connectedProviderIDs={[...connectedProviderIDs()]}
          onSaved={() => canvas.fetchDefinitions()}
          onClose={() => dialog.close()}
        />
      ),
    )
  }

  function handleDelete() {
    const inst = instance()
    if (!inst) return
    canvas.closeNodeContextMenu()
    canvas.removeInstance(inst.id)
    canvas.deselect()
  }

  /** Retry: re-send the last user message to the errored agent */
  async function handleRetry() {
    const inst = instance()
    if (!inst?.sessionID) return
    canvas.closeNodeContextMenu()

    const msgs = sync.data.message[inst.sessionID] ?? []
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return

    const parts = sync.data.part[lastUserMsg.id] ?? []
    const textParts = parts.filter((p: any) => p.type === "text")
    if (textParts.length === 0) return

    await canvas.setInstanceState(inst.id, "working")

    const def = definition()
    await sdk.client.session.promptAsync({
      sessionID: inst.sessionID,
      agent: def?.id ?? inst.agentDefinitionID,
      ...(def?.model ? { model: { providerID: def.model.providerID, modelID: def.model.modelID } } : {}),
      parts: textParts.map((p: any) => ({ type: "text" as const, text: p.text })),
    })
  }

  /** Reset errored agent back to idle */
  async function handleReset() {
    const inst = instance()
    if (!inst) return
    canvas.closeNodeContextMenu()
    await canvas.setInstanceState(inst.id, "idle")
  }

  /** Copy error message to clipboard */
  async function handleCopyError() {
    const inst = instance()
    if (!inst?.errorMessage) return
    await copyToClipboard(inst.errorMessage)
    canvas.closeNodeContextMenu()
  }

  // Clamp position to keep menu within viewport
  const clampedPos = createMemo(() => {
    const m = canvas.nodeContextMenu
    if (!m) return { x: 0, y: 0 }
    const menuWidth = 220
    const menuHeight = 320 // approximate max height
    const x = Math.min(m.x, window.innerWidth - menuWidth - 8)
    const y = Math.min(m.y, window.innerHeight - menuHeight - 8)
    return { x: Math.max(8, x), y: Math.max(8, y) }
  })

  return (
    <Show when={canvas.nodeContextMenu}>
      {(_menu) => (
        <div
          ref={menuRef}
          class="canvas-context-menu"
          style={{
            left: `${clampedPos().x}px`,
            top: `${clampedPos().y}px`,
          }}
        >
          {/* Agent header */}
          <div
            style={{
              padding: "8px 12px 6px",
              display: "flex",
              "align-items": "center",
              gap: "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
              "margin-bottom": "4px",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                "border-radius": "50%",
                "background-color": definition()?.color ?? "#666",
                "flex-shrink": "0",
              }}
            />
            <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
              <span style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-strong)" }}>
                {definition()?.name ?? instance()?.agentDefinitionID ?? "Agent"}
              </span>
              <Show when={instance()?.state}>
                <span
                  style={{
                    "font-size": "11px",
                    color: instance()?.state === "idle" ? "var(--text-weak)" : "var(--text-warning)",
                    "text-transform": "capitalize",
                  }}
                >
                  {instance()?.state}
                </span>
              </Show>
            </div>
          </div>

          {/* Stats section */}
          <Show when={context()}>
            {(ctx) => (
              <div
                style={{
                  padding: "6px 12px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  "font-size": "11px",
                  color: "var(--text-weak)",
                  "border-bottom": "1px solid var(--border-weak-base)",
                  "margin-bottom": "4px",
                }}
              >
                <ProgressCircle size={16} strokeWidth={2} percentage={ctx().usage ?? 0} />
                <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
                  <span>
                    {ctx().total.toLocaleString()} tokens
                    <Show when={ctx().usage != null}>
                      {" "}
                      · {ctx().usage}%
                    </Show>
                  </span>
                  <Show when={cost()}>
                    <span>{cost()} cost</span>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={!context() && messages().length > 0}>
            <div
              style={{
                padding: "6px 12px",
                "font-size": "11px",
                color: "var(--text-weak)",
                "border-bottom": "1px solid var(--border-weak-base)",
                "margin-bottom": "4px",
              }}
            >
              {messages().length} messages
            </div>
          </Show>

          {/* Spawn agents */}
          <Show when={definition()?.spawnable?.agents && definition()!.spawnable!.agents.length > 0}>
            <div
              style={{
                padding: "4px 12px 2px",
                "font-size": "11px",
                "font-weight": "600",
                color: "var(--text-weak)",
                "text-transform": "uppercase",
                "letter-spacing": "0.05em",
              }}
            >
              Spawn Agent
            </div>
            {definition()!.spawnable!.agents.map((agentId) => {
              const spawnDef = canvas.definitionMap().get(agentId)
              return (
                <button
                  class="canvas-context-menu-item"
                  onClick={() => {
                    const inst = instance()
                    if (!inst) return
                    canvas.closeNodeContextMenu()
                    canvas.spawnChild(inst.id, agentId, props.workspaceSessionID)
                  }}
                >
                  <span class="agent-dot" style={{ background: spawnDef?.color ?? "#666" }} />
                  <span>Spawn {spawnDef?.name ?? agentId}</span>
                </button>
              )
            })}
            <div
              style={{
                "border-bottom": "1px solid var(--border-weak-base)",
                margin: "4px 0",
              }}
            />
          </Show>

          {/* Error Recovery — shown when agent is in error state */}
          <Show when={instance()?.state === "error"}>
            <div
              style={{
                padding: "4px 12px",
                "font-size": "11px",
                color: "var(--canvas-error, #ef4444)",
                "max-width": "200px",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
              title={instance()?.errorMessage}
            >
              {instance()?.errorMessage ?? "Unknown error"}
            </div>
            <button class="canvas-context-menu-item" onClick={handleRetry}>
              <span style={{ "font-size": "13px" }}>&#x21BB;</span>
              <span>Retry Last Prompt</span>
            </button>
            <button class="canvas-context-menu-item" onClick={handleReset}>
              <span style={{ "font-size": "13px" }}>&#x23EE;</span>
              <span>Reset to Idle</span>
            </button>
            <button class="canvas-context-menu-item" onClick={handleCopyError}>
              <span style={{ "font-size": "13px" }}>&#x1F4CB;</span>
              <span>Copy Error</span>
            </button>
            <div class="canvas-context-menu-divider" />
          </Show>

          {/* Actions */}
          <Show when={definition()}>
            <button class="canvas-context-menu-item" onClick={handleEditDefinition}>
              <Icon name="sliders" style={{ width: "14px", height: "14px" }} />
              <span>Edit Definition</span>
            </button>
          </Show>
          <button class="canvas-context-menu-item" onClick={handleDelete} style={{ color: "var(--text-danger)" }}>
            <Icon name="close" style={{ width: "14px", height: "14px" }} />
            <span>Delete Agent</span>
          </button>
        </div>
      )}
    </Show>
  )
}
