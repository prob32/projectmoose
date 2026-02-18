import { type Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { Icon } from "@opencode-ai/ui/icon"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { AgentInstanceInfo, AgentDefinitionInfo } from "@/context/canvas"
import { AgentEditDialog } from "@/components/agent-edit-dialog"
import { getMooseIcon } from "@/components/canvas/moose-icons"
import { createCanvasCostTracker, formatCost } from "@/components/canvas/canvas-cost-tracker"

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

type FolderInfo = {
  id: string
  name: string
  description?: string
  icon?: string
  color: string
  agents: AgentDefinitionInfo[]
}

/** Native agent info from GET /agent (OpenCode's built-in agents) */
type NativeAgentInfo = {
  name: string
  description?: string
  mode: "primary" | "subagent" | "all"
  hidden?: boolean
  native?: boolean
  prompt?: string
  temperature?: number
  model?: { providerID: string; modelID: string }
}

type SidebarAgentsStore = {
  instances: AgentInstanceInfo[]
  definitions: AgentDefinitionInfo[]
  folders: FolderInfo[]
  activeFolder: string
  mcpServerNames: string[]
  providers: ProviderInfo[]
  connectedProviderIDs: string[]
  nativeAgents: NativeAgentInfo[]
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
    folders: [],
    activeFolder: "default",
    mcpServerNames: [],
    providers: [],
    connectedProviderIDs: [],
    nativeAgents: [],
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

  /** Fetch native OpenCode agents (build, plan, compaction, title, etc.) */
  async function fetchNativeAgents(): Promise<void> {
    try {
      const res = await fetch(`${serverUrl}/agent`, {
        headers: { "x-opencode-directory": props.directory },
      })
      if (!res.ok) return
      const data: NativeAgentInfo[] = await res.json()
      // Only keep native agents (the ones hardcoded in agent.ts)
      setStore("nativeAgents", data.filter((a) => a.native))
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
    // Also refresh MCP server names, providers, and folders
    const mcpNames = await fetchMcpServerNames()
    setStore("mcpServerNames", mcpNames)
    fetchProviders()
    fetchFolders()
  }

  async function fetchFolders() {
    try {
      const res = await fetch(`${serverUrl}/moose-agent-folder`, {
        headers: { "x-opencode-directory": props.directory },
      })
      if (!res.ok) return
      const data = await res.json()
      setStore("folders", (data.folders ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        icon: f.icon,
        color: f.color,
        agents: f.agents ?? [],
      })))
      setStore("activeFolder", data.activeFolder ?? "default")
    } catch {
      // ignore
    }
  }

  async function switchFolder(folderId: string) {
    try {
      await fetch(`${serverUrl}/moose-agent-active-folder`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": props.directory,
        },
        body: JSON.stringify({ folderId }),
      })
      setStore("activeFolder", folderId)
      fetchDefinitions()
    } catch {
      // ignore
    }
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

  // ═══ Cost Tracker ═══
  const { costByDefinition, refresh: refreshCosts } = createCanvasCostTracker(
    () => store.instances,
    () => store.folders.flatMap((f) => f.agents),
    serverUrl,
    props.directory,
  )

  // Refresh costs on message updates (SSE)
  const unsubCost = globalSDK.event.on(props.directory, (event) => {
    const { type } = event as { type: string; properties: any }
    if (type === "message.updated") {
      refreshCosts()
    }
  })
  onCleanup(unsubCost)

  // Fetch data when directory changes
  createEffect(() => {
    if (!props.workspaceSessionID) return
    fetchDefinitions()
    fetchInstances()
    fetchNativeAgents()
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
          allDefinitions={[...allDefinitions()]}
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

  // ═══ System Settings State ═══
  const [showSystemSettings, setShowSystemSettings] = createSignal(false)
  const [systemSettings, setSystemSettings] = createStore({
    smallModel: "",     // background model for compaction/title/summary (empty = auto)
    autoCompact: true,  // auto-compaction enabled
    prune: true,        // output pruning enabled
    reservedTokens: 20000, // compaction reserve buffer
  })

  // Load system settings from server config on mount
  createEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${serverUrl}/config`, {
          headers: { "x-opencode-directory": props.directory },
        })
        if (!res.ok) return
        const cfg = await res.json()
        setSystemSettings({
          smallModel: cfg.small_model ?? "",
          autoCompact: cfg.compaction?.auto !== false,
          prune: cfg.compaction?.prune !== false,
          reservedTokens: cfg.compaction?.reserved ?? 20000,
        })
      } catch {
        // ignore
      }
    })()
  })

  // ═══ File Explorer State ═══
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())

  // Auto-expand the active folder on initial load
  createEffect(() => {
    if (store.activeFolder) {
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.add(store.activeFolder)
        return next
      })
    }
  })

  function toggleFolderExpand(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  function isFolderExpanded(folderId: string): boolean {
    return expandedFolders().has(folderId)
  }

  /** All definitions across all folders (for spawnable selection in edit dialog) */
  const allDefinitions = createMemo(() => {
    const defs: AgentDefinitionInfo[] = []
    for (const folder of store.folders) {
      defs.push(...folder.agents)
    }
    return defs
  })

  /** Total agent count across all folders */
  const totalAgentCount = createMemo(() => allDefinitions().length)

  /** Open the edit dialog for an existing agent definition */
  function openEditDialog(definition: AgentDefinitionInfo) {
    dialog.show(
      () => (
        <AgentEditDialog
          existing={definition}
          serverUrl={serverUrl}
          directory={props.directory}
          allDefinitions={[...allDefinitions()]}
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
      {/* Header */}
      <div class="shrink-0 px-4 py-3" style={{ "border-bottom": "1px solid rgba(139, 92, 246, 0.12)" }}>
        <div class="flex items-center justify-between">
          <span style={{ color: "#e2dff0", "font-size": "14px", "font-weight": "600", "letter-spacing": "0.01em" }}>
            Agent Explorer
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
            {totalAgentCount()}
          </span>
        </div>
      </div>

      {/* File-explorer tree */}
      <div class="flex-1 min-h-0 overflow-y-auto py-1" style={{ "scrollbar-width": "thin" }}>
        <Show
          when={store.folders.length > 0}
          fallback={
            <div class="px-4 py-8 text-center">
              <div style={{ color: "#8b87a0", "font-size": "12px" }}>
                No agent folders
              </div>
              <div style={{ color: "#6b6780", "font-size": "11px", "margin-top": "4px" }}>
                Create your first agent type below
              </div>
            </div>
          }
        >
          <div class="flex flex-col">
            <For each={store.folders}>
              {(folder) => {
                const isActive = () => store.activeFolder === folder.id
                const isExpanded = () => isFolderExpanded(folder.id)
                const agentCount = () => folder.agents.length

                return (
                  <div class="flex flex-col">
                    {/* ─── Folder row (tree node) ─── */}
                    <div
                      class="group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-all select-none"
                      style={{
                        background: isActive() ? `${folder.color}10` : "transparent",
                        "border-left": isActive()
                          ? `2px solid ${folder.color}`
                          : "2px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive()) e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)"
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive()) e.currentTarget.style.background = "transparent"
                      }}
                      onClick={() => {
                        // Clicking a folder: set it as active and expand it
                        if (!isActive()) {
                          switchFolder(folder.id)
                        }
                        // Always toggle expand/collapse
                        toggleFolderExpand(folder.id)
                      }}
                    >
                      {/* Chevron */}
                      <span
                        style={{
                          "font-size": "10px",
                          color: isActive() ? folder.color : "#6b6780",
                          width: "12px",
                          "text-align": "center",
                          "flex-shrink": "0",
                          transition: "transform 0.15s ease",
                          transform: isExpanded() ? "rotate(90deg)" : "rotate(0deg)",
                        }}
                      >
                        ▶
                      </span>

                      {/* Folder icon */}
                      <span
                        style={{
                          "font-size": "13px",
                          "flex-shrink": "0",
                          opacity: isActive() ? "1" : "0.6",
                        }}
                      >
                        {isExpanded() ? "📂" : "📁"}
                      </span>

                      {/* Folder name */}
                      <span
                        class="flex-1 truncate"
                        style={{
                          "font-size": "12px",
                          "font-weight": isActive() ? "600" : "500",
                          color: isActive() ? folder.color : "#c4c0d4",
                          "line-height": "1.3",
                        }}
                      >
                        {folder.name}
                      </span>

                      {/* Agent count badge */}
                      <span
                        style={{
                          "font-size": "10px",
                          "font-weight": "600",
                          color: isActive() ? folder.color : "#6b6780",
                          background: isActive() ? `${folder.color}18` : "rgba(139, 92, 246, 0.08)",
                          padding: "1px 6px",
                          "border-radius": "8px",
                          "flex-shrink": "0",
                        }}
                      >
                        {agentCount()}
                      </span>

                      {/* Active indicator */}
                      <Show when={isActive()}>
                        <span
                          style={{
                            "font-size": "7px",
                            color: folder.color,
                            "flex-shrink": "0",
                          }}
                          title="Active folder"
                        >
                          ●
                        </span>
                      </Show>
                    </div>

                    {/* ─── Agent children (indented tree leaves) ─── */}
                    <Show when={isExpanded()}>
                      <div
                        class="flex flex-col"
                        style={{
                          "margin-left": "14px",
                          "border-left": `1px solid ${isActive() ? folder.color + "30" : "rgba(139, 92, 246, 0.08)"}`,
                        }}
                      >
                        <Show
                          when={folder.agents.length > 0}
                          fallback={
                            <div
                              style={{
                                "padding-left": "12px",
                                "font-size": "11px",
                                color: "#6b6780",
                                "font-style": "italic",
                                padding: "6px 12px",
                              }}
                            >
                              No agents in this folder
                            </div>
                          }
                        >
                          <For each={folder.agents}>
                            {(def) => {
                              const count = () => instanceCountByDef()[def.id] ?? 0
                              const isLocked = () => def.id === "bull_moose"
                              const rolePill = () =>
                                ROLE_PILL_COLORS[def.role ?? ""] ?? { bg: "rgba(139, 92, 246, 0.1)", text: "#8b87a0" }
                              const MooseIcon = () => getMooseIcon(def.role)
                              const defCost = () => costByDefinition()[def.id]?.cost ?? 0

                              return (
                                <ContextMenu>
                                  <ContextMenu.Trigger
                                    as="div"
                                    class="group flex items-center gap-2 pl-3 pr-2 py-2 cursor-pointer transition-all"
                                    style={{ background: "transparent" }}
                                    onMouseEnter={(e: MouseEvent) => {
                                      ;(e.currentTarget as HTMLElement).style.background = "rgba(139, 92, 246, 0.08)"
                                    }}
                                    onMouseLeave={(e: MouseEvent) => {
                                      ;(e.currentTarget as HTMLElement).style.background = "transparent"
                                    }}
                                    onClick={() => openEditDialog(def)}
                                  >
                                    {/* Moose icon */}
                                    <div class="shrink-0" style={{ opacity: "0.8" }}>
                                      {(() => {
                                        const IconComp = MooseIcon()
                                        return <IconComp size={20} color={def.color} />
                                      })()}
                                    </div>

                                    {/* Name + role stacked */}
                                    <div class="flex-1 min-w-0 overflow-hidden">
                                      <div class="flex items-center gap-1.5">
                                        <span
                                          class="truncate"
                                          style={{
                                            color: "#e2dff0",
                                            "font-size": "12px",
                                            "font-weight": "500",
                                            "line-height": "1.3",
                                          }}
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

                                    {/* Cost display (right side) */}
                                    <Show when={defCost() > 0}>
                                      <span
                                        class="shrink-0"
                                        style={{
                                          color: "#4ade80",
                                          "font-size": "10px",
                                          "font-weight": "500",
                                          "font-family": "monospace",
                                          "margin-left": "4px",
                                        }}
                                      >
                                        {formatCost(defCost())}
                                      </span>
                                    </Show>
                                  </ContextMenu.Trigger>
                                  <ContextMenu.Portal>
                                    <ContextMenu.Content>
                                      <div class="px-2 py-1.5 border-b border-border-weak-base mb-1">
                                        <div class="flex items-center gap-2">
                                          <div class="size-2.5 rounded-full" style={{ "background-color": def.color }} />
                                          <span class="text-12-medium text-text-strong">{def.name}</span>
                                        </div>
                                        <Show when={def.role}>
                                          <div class="text-11-regular text-text-weak mt-0.5 capitalize">
                                            {def.role?.replace(/_/g, " ")}
                                          </div>
                                        </Show>
                                      </div>
                                      <ContextMenu.Item onSelect={() => openEditDialog(def)}>
                                        <Icon name="sliders" class="size-3.5" />
                                        <ContextMenu.ItemLabel>Edit Definition</ContextMenu.ItemLabel>
                                      </ContextMenu.Item>
                                      <Show when={!isLocked()}>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onSelect={() => deleteDefinition(def.id)}>
                                          <Icon name="close" class="size-3.5" />
                                          <ContextMenu.ItemLabel>Delete Definition</ContextMenu.ItemLabel>
                                        </ContextMenu.Item>
                                      </Show>
                                    </ContextMenu.Content>
                                  </ContextMenu.Portal>
                                </ContextMenu>
                              )
                            }}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* ═══ System Agents (native OpenCode agents) ═══ */}
      <Show when={store.nativeAgents.length > 0}>
        <div
          class="shrink-0"
          style={{ "border-top": "1px solid rgba(139, 92, 246, 0.12)" }}
        >
          {/* Header with settings gear */}
          <div class="flex items-center justify-between px-3 pt-2.5 pb-1">
            <span
              style={{
                color: "#8b87a0",
                "font-size": "10px",
                "font-weight": "700",
                "letter-spacing": "0.06em",
                "text-transform": "uppercase",
              }}
            >
              System Agents
            </span>
            <button
              class="flex items-center justify-center size-5 rounded cursor-pointer transition-all"
              style={{ color: "#6b6780" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#b794f6"
                e.currentTarget.style.background = "rgba(139, 92, 246, 0.15)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6b6780"
                e.currentTarget.style.background = "transparent"
              }}
              onClick={() => setShowSystemSettings(!showSystemSettings())}
              title="System agent settings"
            >
              <Icon name="sliders" class="size-3" />
            </button>
          </div>

          {/* ─── Settings panel (toggled by gear) ─── */}
          <Show when={showSystemSettings()}>
            <div
              class="mx-2 mb-2 rounded-lg overflow-hidden"
              style={{
                background: "rgba(139, 92, 246, 0.04)",
                border: "1px solid rgba(139, 92, 246, 0.12)",
              }}
            >
              {/* Background model (for compaction, title, summary) */}
              <div class="px-3 py-2" style={{ "border-bottom": "1px solid rgba(139, 92, 246, 0.08)" }}>
                <div class="flex items-center justify-between mb-1.5">
                  <span style={{ color: "#c4c0d4", "font-size": "11px", "font-weight": "600" }}>
                    Background Model
                  </span>
                </div>
                <div style={{ color: "#6b6780", "font-size": "10px", "margin-bottom": "6px" }}>
                  Used by compaction, title &amp; summary agents
                </div>
                <select
                  style={{
                    width: "100%",
                    background: "rgba(15, 13, 26, 0.8)",
                    color: "#e2dff0",
                    border: "1px solid rgba(139, 92, 246, 0.2)",
                    "border-radius": "6px",
                    padding: "4px 8px",
                    "font-size": "11px",
                    outline: "none",
                    cursor: "pointer",
                  }}
                  value={systemSettings.smallModel}
                  onChange={(e) => setSystemSettings("smallModel", e.currentTarget.value)}
                >
                  <option value="">Auto (cheapest available)</option>
                  <For each={store.providers.filter((p) => store.connectedProviderIDs.includes(p.id))}>
                    {(provider) => (
                      <For each={Object.values(provider.models)}>
                        {(model) => (
                          <option value={`${provider.id}/${model.id}`}>
                            {provider.name ?? provider.id} / {model.name ?? model.id}
                          </option>
                        )}
                      </For>
                    )}
                  </For>
                </select>
              </div>

              {/* Compaction settings */}
              <div class="px-3 py-2" style={{ "border-bottom": "1px solid rgba(139, 92, 246, 0.08)" }}>
                <div class="flex items-center justify-between mb-1.5">
                  <span style={{ color: "#c4c0d4", "font-size": "11px", "font-weight": "600" }}>
                    Auto-compaction
                  </span>
                  <button
                    class="rounded-full transition-all cursor-pointer"
                    style={{
                      width: "32px",
                      height: "18px",
                      background: systemSettings.autoCompact ? "rgba(139, 92, 246, 0.5)" : "rgba(107, 103, 128, 0.3)",
                      padding: "2px",
                      border: "none",
                    }}
                    onClick={() => setSystemSettings("autoCompact", !systemSettings.autoCompact)}
                  >
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        "border-radius": "50%",
                        background: systemSettings.autoCompact ? "#b794f6" : "#6b6780",
                        transition: "transform 0.15s ease",
                        transform: systemSettings.autoCompact ? "translateX(14px)" : "translateX(0)",
                      }}
                    />
                  </button>
                </div>
                <div style={{ color: "#6b6780", "font-size": "10px" }}>
                  Summarize context when token limit is reached
                </div>
              </div>

              {/* Pruning settings */}
              <div class="px-3 py-2" style={{ "border-bottom": "1px solid rgba(139, 92, 246, 0.08)" }}>
                <div class="flex items-center justify-between mb-1.5">
                  <span style={{ color: "#c4c0d4", "font-size": "11px", "font-weight": "600" }}>
                    Output pruning
                  </span>
                  <button
                    class="rounded-full transition-all cursor-pointer"
                    style={{
                      width: "32px",
                      height: "18px",
                      background: systemSettings.prune ? "rgba(139, 92, 246, 0.5)" : "rgba(107, 103, 128, 0.3)",
                      padding: "2px",
                      border: "none",
                    }}
                    onClick={() => setSystemSettings("prune", !systemSettings.prune)}
                  >
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        "border-radius": "50%",
                        background: systemSettings.prune ? "#b794f6" : "#6b6780",
                        transition: "transform 0.15s ease",
                        transform: systemSettings.prune ? "translateX(14px)" : "translateX(0)",
                      }}
                    />
                  </button>
                </div>
                <div style={{ color: "#6b6780", "font-size": "10px" }}>
                  Trim old tool outputs to save context space
                </div>
              </div>

              {/* Context reserve buffer */}
              <div class="px-3 py-2">
                <div class="flex items-center justify-between mb-1.5">
                  <span style={{ color: "#c4c0d4", "font-size": "11px", "font-weight": "600" }}>
                    Reserve buffer
                  </span>
                  <span style={{ color: "#8b87a0", "font-size": "10px", "font-weight": "500" }}>
                    {(systemSettings.reservedTokens / 1000).toFixed(0)}k tokens
                  </span>
                </div>
                <input
                  type="range"
                  min="5000"
                  max="50000"
                  step="1000"
                  value={systemSettings.reservedTokens}
                  onInput={(e) => setSystemSettings("reservedTokens", parseInt(e.currentTarget.value))}
                  style={{
                    width: "100%",
                    height: "4px",
                    "accent-color": "#8b5cf6",
                    cursor: "pointer",
                  }}
                />
                <div style={{ color: "#6b6780", "font-size": "10px", "margin-top": "2px" }}>
                  Tokens reserved to avoid overflow during compaction
                </div>
              </div>
            </div>
          </Show>

          {/* ─── Modes (build, plan) ─── */}
          <div class="px-2 pb-1">
            <For each={store.nativeAgents.filter((a) => !a.hidden && a.mode === "primary")}>
              {(agent) => (
                <div
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md"
                  style={{ background: "rgba(139, 92, 246, 0.06)" }}
                >
                  <span style={{ "font-size": "12px", "flex-shrink": "0" }}>
                    {agent.name === "build" ? "🔨" : agent.name === "plan" ? "📋" : "⚡"}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span
                        class="truncate"
                        style={{
                          color: "#e2dff0",
                          "font-size": "12px",
                          "font-weight": "500",
                        }}
                      >
                        {agent.name}
                      </span>
                      <span
                        style={{
                          "font-size": "9px",
                          "font-weight": "600",
                          "letter-spacing": "0.04em",
                          "text-transform": "uppercase",
                          padding: "1px 5px",
                          "border-radius": "4px",
                          background: "rgba(34, 197, 94, 0.12)",
                          color: "#81c784",
                          "line-height": "1.4",
                        }}
                      >
                        mode
                      </span>
                    </div>
                    <Show when={agent.description}>
                      <div
                        class="truncate"
                        style={{ color: "#6b6780", "font-size": "10px", "margin-top": "1px" }}
                      >
                        {agent.description}
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* ─── Subagents (general, explore) ─── */}
          <Show when={store.nativeAgents.filter((a) => !a.hidden && a.mode === "subagent").length > 0}>
            <div class="px-2 pb-1">
              <For each={store.nativeAgents.filter((a) => !a.hidden && a.mode === "subagent")}>
                {(agent) => (
                  <div
                    class="flex items-center gap-2 px-2 py-1 rounded-md"
                    style={{ background: "transparent" }}
                  >
                    <span style={{ "font-size": "12px", "flex-shrink": "0" }}>
                      {agent.name === "explore" ? "🔍" : agent.name === "general" ? "🧩" : "⚡"}
                    </span>
                    <span
                      class="truncate"
                      style={{
                        color: "#c4c0d4",
                        "font-size": "11px",
                        "font-weight": "500",
                      }}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        "font-size": "9px",
                        "font-weight": "600",
                        "letter-spacing": "0.04em",
                        "text-transform": "uppercase",
                        padding: "1px 5px",
                        "border-radius": "4px",
                        background: "rgba(33, 150, 243, 0.12)",
                        color: "#64b5f6",
                        "line-height": "1.4",
                      }}
                    >
                      subagent
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* ─── Background agents (compaction, title, summary) ─── */}
          <Show when={store.nativeAgents.filter((a) => a.hidden).length > 0}>
            <div class="px-2 pb-2">
              <For each={store.nativeAgents.filter((a) => a.hidden)}>
                {(agent) => (
                  <div
                    class="flex items-center gap-2 px-2 py-1 rounded-md"
                    style={{ background: "transparent" }}
                  >
                    <span style={{ "font-size": "12px", "flex-shrink": "0" }}>
                      {agent.name === "compaction" ? "🗜️" : agent.name === "title" ? "🏷️" : "📝"}
                    </span>
                    <span
                      class="truncate"
                      style={{
                        color: "#8b87a0",
                        "font-size": "11px",
                        "font-weight": "500",
                      }}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        "font-size": "9px",
                        "font-weight": "600",
                        "letter-spacing": "0.04em",
                        "text-transform": "uppercase",
                        padding: "1px 5px",
                        "border-radius": "4px",
                        background: "rgba(107, 103, 128, 0.08)",
                        color: "#6b6780",
                        "line-height": "1.4",
                      }}
                    >
                      background
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

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
