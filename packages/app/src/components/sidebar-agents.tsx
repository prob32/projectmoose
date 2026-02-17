import { type Component, For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { AgentInstanceInfo, AgentDefinitionInfo } from "@/context/canvas"
import { AgentEditDialog } from "@/components/agent-edit-dialog"
import { getMooseIcon } from "@/components/canvas/moose-icons"

export type ProviderInfo = {
  id: string
  name: string
  models: Record<string, { id: string; name?: string }>
}

/** Role-specific pill colors for the table badges (LM Studio style) */
const ROLE_PILL_COLORS: Record<string, { bg: string; text: string }> = {
  orchestrator: { bg: "rgba(139, 69, 19, 0.2)", text: "#d4a574" },
  sub_orchestrator: { bg: "rgba(255, 107, 53, 0.2)", text: "#ff9b6a" },
  coder: { bg: "rgba(76, 175, 80, 0.2)", text: "#81c784" },
  researcher: { bg: "rgba(33, 150, 243, 0.2)", text: "#64b5f6" },
  debugger: { bg: "rgba(233, 30, 99, 0.2)", text: "#f06292" },
  general: { bg: "rgba(156, 39, 176, 0.2)", text: "#ba68c8" },
  explorer: { bg: "rgba(0, 188, 212, 0.2)", text: "#4dd0e1" },
}

type SidebarAgentsStore = {
  instances: AgentInstanceInfo[]
  definitions: AgentDefinitionInfo[]
  mcpServerNames: string[]
  providers: ProviderInfo[]
  connectedProviderIDs: string[]
}

export const SidebarAgents: Component<{
  directory: string
  workspaceSessionID: string
}> = (props) => {
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const serverUrl = globalSDK.url

  /** Fetch MCP server names on-demand (sidebar is outside SyncProvider) */
  async function fetchMcpServerNames(): Promise<string[]> {
    try {
      const res = await fetch(`${serverUrl}/mcp`, {
        headers: { "x-opencode-directory": props.directory },
      })
      if (!res.ok) return []
      const data = await res.json()
      return Object.keys(data ?? {}).sort()
    } catch {
      return []
    }
  }

  const [store, setStore] = createStore<SidebarAgentsStore>({
    instances: [],
    definitions: [],
    mcpServerNames: [],
    providers: [],
    connectedProviderIDs: [],
  })

  /** Fetch available providers and their models */
  async function fetchProviders(): Promise<void> {
    try {
      const res = await fetch(`${serverUrl}/provider`, {
        headers: { "x-opencode-directory": props.directory },
      })
      if (!res.ok) return
      const data = await res.json()
      setStore("providers", data.all ?? [])
      setStore("connectedProviderIDs", data.connected ?? [])
    } catch {
      // silently ignore
    }
  }

  // Fetch definitions + MCP server names + providers
  async function fetchDefinitions() {
    try {
      const res = await fetch(`${serverUrl}/moose-agent`, {
        headers: { "x-opencode-directory": props.directory },
      })
      if (!res.ok) return
      const data: AgentDefinitionInfo[] = await res.json()
      setStore("definitions", reconcile(data, { key: "id" }))
    } catch {
      // silently ignore
    }
    // Also refresh MCP server names and providers
    const mcpNames = await fetchMcpServerNames()
    setStore("mcpServerNames", mcpNames)
    fetchProviders()
  }

  // Fetch instances (still needed for sidebar instance count badge)
  async function fetchInstances() {
    try {
      const res = await fetch(
        `${serverUrl}/agent-instance?workspaceSessionID=${encodeURIComponent(props.workspaceSessionID)}`,
        { headers: { "x-opencode-directory": props.directory } },
      )
      if (!res.ok) return
      const data: AgentInstanceInfo[] = await res.json()
      setStore("instances", reconcile(data, { key: "id" }))
    } catch {
      // ignore
    }
  }

  /** Delete an agent definition */
  async function deleteDefinition(id: string) {
    try {
      await fetch(`${serverUrl}/moose-agent/${id}`, {
        method: "DELETE",
        headers: { "x-opencode-directory": props.directory },
      })
      fetchDefinitions()
    } catch {
      // ignore
    }
  }

  // Subscribe to real-time events
  const unsub = globalSDK.event.on(props.directory, (event) => {
    const { type, properties } = event as { type: string; properties: any }
    if (!type || !properties) return

    switch (type) {
      case "moose.agent.spawned": {
        const inst = properties.instance as AgentInstanceInfo
        if (!inst) break
        setStore(
          "instances",
          produce((draft) => {
            if (!draft.find((i) => i.id === inst.id)) {
              draft.push(inst)
            }
          }),
        )
        break
      }
      case "moose.agent.state_changed": {
        setStore(
          "instances",
          (i) => i.id === properties.instanceID,
          produce((draft) => {
            draft.state = properties.state
            if (properties.error) draft.errorMessage = properties.error
          }),
        )
        break
      }
      case "moose.agent.deleted": {
        setStore("instances", (instances) => instances.filter((i) => i.id !== properties.instanceID))
        break
      }
      case "moose.definition.updated": {
        if (properties.definitions) {
          setStore("definitions", reconcile(properties.definitions, { key: "id" }))
        }
        break
      }
    }
  })
  onCleanup(unsub)

  // Fetch data when directory changes
  createEffect(() => {
    if (!props.workspaceSessionID) return
    fetchDefinitions()
    fetchInstances()
  })

  // Count active instances per definition
  const instanceCountByDef = createMemo(() => {
    const counts: Record<string, number> = {}
    for (const inst of store.instances) {
      counts[inst.agentDefinitionID] = (counts[inst.agentDefinitionID] ?? 0) + 1
    }
    return counts
  })

  /** Open the create dialog for a brand new agent definition */
  function openCreateDialog() {
    dialog.show(
      () => (
        <AgentEditDialog
          serverUrl={serverUrl}
          directory={props.directory}
          allDefinitions={[...store.definitions]}
          mcpServerNames={[...store.mcpServerNames]}
          providers={[...store.providers]}
          connectedProviderIDs={[...store.connectedProviderIDs]}
          onSaved={() => {
            fetchDefinitions()
          }}
          onClose={() => dialog.close()}
        />
      ),
    )
  }

  /** Open the edit dialog for an existing agent definition */
  function openEditDialog(definition: AgentDefinitionInfo) {
    dialog.show(
      () => (
        <AgentEditDialog
          existing={definition}
          serverUrl={serverUrl}
          directory={props.directory}
          allDefinitions={[...store.definitions]}
          mcpServerNames={[...store.mcpServerNames]}
          providers={[...store.providers]}
          connectedProviderIDs={[...store.connectedProviderIDs]}
          onSaved={() => {
            fetchDefinitions()
          }}
          onClose={() => dialog.close()}
        />
      ),
    )
  }

  return (
    <div class="flex flex-col h-full min-h-0" style={{ "background-color": "#0f0d1a" }}>
      {/* Header — LM Studio style */}
      <div class="shrink-0 px-4 py-3" style={{ "border-bottom": "1px solid rgba(139, 92, 246, 0.12)" }}>
        <div class="flex items-center justify-between">
          <span style={{ color: "#e2dff0", "font-size": "14px", "font-weight": "600", "letter-spacing": "0.01em" }}>
            Agent Types
          </span>
          <span
            style={{
              color: "#8b87a0",
              "font-size": "11px",
              "font-weight": "600",
              background: "rgba(139, 92, 246, 0.12)",
              padding: "2px 8px",
              "border-radius": "10px",
            }}
          >
            {store.definitions.length}
          </span>
        </div>
      </div>

      {/* Definition list — table-style rows */}
      <div class="flex-1 min-h-0 overflow-y-auto py-1" style={{ "scrollbar-width": "thin" }}>
        <Show
          when={store.definitions.length > 0}
          fallback={
            <div class="px-4 py-8 text-center">
              <div style={{ color: "#8b87a0", "font-size": "12px" }}>No agent types defined</div>
              <div style={{ color: "#6b6780", "font-size": "11px", "margin-top": "4px" }}>Create your first agent type below</div>
            </div>
          }
        >
          <div class="flex flex-col">
            <For each={store.definitions}>
              {(def) => {
                const count = () => instanceCountByDef()[def.id] ?? 0
                const isLocked = () => def.id === "bull_moose"
                const rolePill = () => ROLE_PILL_COLORS[def.role ?? ""] ?? { bg: "rgba(139, 92, 246, 0.1)", text: "#8b87a0" }
                const MooseIcon = () => getMooseIcon(def.role)

                return (
                  <DropdownMenu>
                    <div
                      class="group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all"
                      style={{
                        "border-bottom": "1px solid rgba(139, 92, 246, 0.06)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(139, 92, 246, 0.08)"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent"
                      }}
                      onClick={() => openEditDialog(def)}
                    >
                      {/* Moose icon */}
                      <div class="shrink-0" style={{ opacity: "0.8" }}>
                        {(() => {
                          const Icon = MooseIcon()
                          return <Icon size={24} color={def.color} />
                        })()}
                      </div>

                      {/* Name + role/description stacked */}
                      <div class="flex-1 min-w-0 overflow-hidden">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="truncate"
                            style={{ color: "#e2dff0", "font-size": "13px", "font-weight": "600", "line-height": "1.3" }}
                          >
                            {def.name}
                          </span>
                          <Show when={count() > 0}>
                            <span
                              class="shrink-0"
                              style={{
                                "font-size": "9px",
                                "font-weight": "700",
                                color: "#22c55e",
                                background: "rgba(34, 197, 94, 0.15)",
                                padding: "1px 5px",
                                "border-radius": "4px",
                                "line-height": "1.4",
                              }}
                            >
                              {count()}
                            </span>
                          </Show>
                          <Show when={isLocked()}>
                            <span
                              class="shrink-0"
                              style={{
                                "font-size": "8px",
                                color: "#8b5cf6",
                                background: "rgba(139, 92, 246, 0.15)",
                                padding: "1px 4px",
                                "border-radius": "3px",
                                "font-weight": "700",
                                "letter-spacing": "0.04em",
                                "line-height": "1.4",
                              }}
                            >
                              ★
                            </span>
                          </Show>
                        </div>
                        {/* Role pill underneath the name — never competes for horizontal space */}
                        <div class="flex items-center gap-1.5 mt-0.5">
                          <Show when={def.role}>
                            <span
                              style={{
                                "font-size": "9px",
                                "font-weight": "600",
                                "letter-spacing": "0.04em",
                                "text-transform": "uppercase",
                                padding: "1px 5px",
                                "border-radius": "4px",
                                background: rolePill().bg,
                                color: rolePill().text,
                                "line-height": "1.4",
                              }}
                            >
                              {def.role?.replace(/_/g, " ")}
                            </span>
                          </Show>
                          <Show when={def.description}>
                            <span
                              class="truncate"
                              style={{ color: "#6b6780", "font-size": "10px", "line-height": "1.3" }}
                            >
                              {def.description}
                            </span>
                          </Show>
                        </div>
                      </div>

                      {/* Context menu trigger — right side */}
                      <DropdownMenu.Trigger
                        as="button"
                        class="shrink-0 size-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "#8b87a0" }}
                        onClick={(e: MouseEvent) => e.stopPropagation()}
                      >
                        <Icon name="dot-grid" class="size-3" />
                      </DropdownMenu.Trigger>
                    </div>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        {/* Header */}
                        <div class="px-2 py-1.5 border-b border-border-weak-base mb-1">
                          <div class="flex items-center gap-2">
                            <div class="size-2.5 rounded-full" style={{ "background-color": def.color }} />
                            <span class="text-12-medium text-text-strong">{def.name}</span>
                          </div>
                          <Show when={def.role}>
                            <div class="text-11-regular text-text-weak mt-0.5 capitalize">{def.role?.replace(/_/g, " ")}</div>
                          </Show>
                        </div>
                        <DropdownMenu.Item onSelect={() => openEditDialog(def)}>
                          <Icon name="sliders" class="size-3.5" />
                          <DropdownMenu.ItemLabel>Edit Definition</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <Show when={!isLocked()}>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item onSelect={() => deleteDefinition(def.id)}>
                            <Icon name="close" class="size-3.5" />
                            <DropdownMenu.ItemLabel>Delete Definition</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* Create new agent type button */}
      <div
        class="shrink-0 px-3 py-3"
        style={{ "border-top": "1px solid rgba(139, 92, 246, 0.12)" }}
      >
        <button
          onClick={openCreateDialog}
          class="w-full flex items-center justify-center gap-2 py-2 rounded-lg cursor-pointer transition-all"
          style={{
            background: "rgba(139, 92, 246, 0.12)",
            color: "#b794f6",
            border: "1px solid rgba(139, 92, 246, 0.2)",
            "font-size": "13px",
            "font-weight": "600",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(139, 92, 246, 0.2)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(139, 92, 246, 0.12)"
          }}
        >
          <span style={{ "font-size": "16px" }}>+</span>
          Create Agent Type
        </button>
      </div>
    </div>
  )
}
