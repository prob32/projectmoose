import { type Component, For, Show, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { AgentDefinitionInfo } from "@/context/canvas"
import type { ProviderInfo } from "@/components/sidebar-agents"

/** Preset color palette for agent dot colors */
const COLOR_PRESETS = [
  "#FF6B35", // orange
  "#00BCD4", // teal
  "#8E24AA", // purple
  "#4CAF50", // green
  "#E91E63", // pink
  "#FFC107", // amber
  "#2196F3", // blue
  "#FF5722", // deep orange
  "#009688", // dark teal
  "#7C4DFF", // violet
]

type AgentFormState = {
  id: string
  name: string
  description: string
  color: string
  prompt: string
  role: string
  temperature: string
  idle_timeout: string
  // Model
  modelProviderID: string
  modelModelID: string
  // MCP
  mcpServers: string[]
  mcpDeny: string
  mcpAllSelected: boolean
  // Spawnable
  spawnableAgents: string[]
  spawnableLimit: string
}

function generateID(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
  return `agent_${slug || "custom"}_${Date.now().toString(36).slice(-4)}`
}

export type AgentEditDialogProps = {
  /** Existing definition to edit — undefined means create mode */
  existing?: AgentDefinitionInfo
  /** Server URL for API calls */
  serverUrl: string
  /** Directory header for API calls */
  directory: string
  /** All known agent definitions (for spawnable selection) */
  allDefinitions?: AgentDefinitionInfo[]
  /** Available MCP server names */
  mcpServerNames?: string[]
  /** Available providers with their models */
  providers?: ProviderInfo[]
  /** IDs of providers that are currently connected/authenticated */
  connectedProviderIDs?: string[]
  /** Called after successful create/update with the definition */
  onSaved?: (definition: AgentDefinitionInfo) => void
  /** Called when dialog requests close */
  onClose?: () => void
}

export const AgentEditDialog: Component<AgentEditDialogProps> = (props) => {
  const isEdit = () => !!props.existing

  // Determine initial MCP server selection
  // If existing.mcp.servers is defined, those are explicitly selected
  // If undefined/empty, all servers are available (allSelected mode)
  const initialMcpServers = () => props.existing?.mcp?.servers ?? []
  const initialMcpAllSelected = () => !props.existing?.mcp?.servers || props.existing.mcp.servers.length === 0

  const [form, setForm] = createStore<AgentFormState>({
    id: props.existing?.id ?? "",
    name: props.existing?.name ?? "",
    description: props.existing?.description ?? "",
    color: props.existing?.color ?? COLOR_PRESETS[0],
    prompt: props.existing?.prompt ?? "",
    role: props.existing?.role ?? "",
    temperature: props.existing?.temperature?.toString() ?? "",
    idle_timeout: props.existing?.idle_timeout?.toString() ?? "120",
    // Model
    modelProviderID: props.existing?.model?.providerID ?? "",
    modelModelID: props.existing?.model?.modelID ?? "",
    // MCP
    mcpServers: initialMcpServers(),
    mcpDeny: props.existing?.mcp?.deny?.join(", ") ?? "",
    mcpAllSelected: initialMcpAllSelected(),
    // Spawnable
    spawnableAgents: props.existing?.spawnable?.agents ?? [],
    spawnableLimit: props.existing?.spawnable?.limit?.toString() ?? "",
  })

  const [saving, setSaving] = createStore({ active: false, error: "" })

  const canSubmit = createMemo(() => {
    return form.name.trim().length > 0 && form.color.match(/^#[0-9a-fA-F]{6}$/) && form.prompt.trim().length > 0
  })

  // Other definitions for spawnable selection (exclude self)
  const otherDefinitions = createMemo(() => {
    const defs = props.allDefinitions ?? []
    const selfID = props.existing?.id
    return selfID ? defs.filter((d) => d.id !== selfID) : defs
  })

  /** Connected providers (prioritized) + all providers */
  const sortedProviders = createMemo(() => {
    const all = props.providers ?? []
    const connected = new Set(props.connectedProviderIDs ?? [])
    // Put connected providers first, then the rest
    return [...all].sort((a, b) => {
      const aConn = connected.has(a.id) ? 0 : 1
      const bConn = connected.has(b.id) ? 0 : 1
      if (aConn !== bConn) return aConn - bConn
      return (a.name ?? a.id).localeCompare(b.name ?? b.id)
    })
  })

  /** Models for the currently selected provider */
  const modelsForProvider = createMemo(() => {
    if (!form.modelProviderID) return []
    const provider = (props.providers ?? []).find((p) => p.id === form.modelProviderID)
    if (!provider) return []
    return Object.values(provider.models)
      .map((m) => ({ id: m.id, name: m.name ?? m.id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const hasProviders = createMemo(() => (props.providers ?? []).length > 0)

  function toggleMcpServer(name: string) {
    setForm(
      produce((draft) => {
        const idx = draft.mcpServers.indexOf(name)
        if (idx >= 0) {
          draft.mcpServers.splice(idx, 1)
        } else {
          draft.mcpServers.push(name)
        }
        // If manually toggling, leave allSelected mode
        draft.mcpAllSelected = false
      }),
    )
  }

  function toggleMcpAllSelected() {
    setForm(
      produce((draft) => {
        draft.mcpAllSelected = !draft.mcpAllSelected
        if (draft.mcpAllSelected) {
          draft.mcpServers = []
        }
      }),
    )
  }

  function toggleSpawnableAgent(id: string) {
    setForm(
      produce((draft) => {
        const idx = draft.spawnableAgents.indexOf(id)
        if (idx >= 0) {
          draft.spawnableAgents.splice(idx, 1)
        } else {
          draft.spawnableAgents.push(id)
        }
      }),
    )
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!canSubmit() || saving.active) return

    setSaving("active", true)
    setSaving("error", "")

    // Build model field
    const model =
      form.modelProviderID.trim() && form.modelModelID.trim()
        ? { providerID: form.modelProviderID.trim(), modelID: form.modelModelID.trim() }
        : undefined

    // Build mcp field
    const mcpServers = form.mcpAllSelected ? undefined : form.mcpServers.length > 0 ? [...form.mcpServers] : undefined
    const mcpDeny = form.mcpDeny.trim()
      ? form.mcpDeny
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined
    const mcp = mcpServers || mcpDeny ? { servers: mcpServers, deny: mcpDeny } : undefined

    // Build spawnable field
    const spawnable =
      form.spawnableAgents.length > 0
        ? {
            agents: [...form.spawnableAgents],
            limit: form.spawnableLimit.trim() === "auto" ? ("auto" as const) : parseInt(form.spawnableLimit, 10) || 5,
          }
        : undefined

    const definition: AgentDefinitionInfo = {
      id: isEdit() ? props.existing!.id : generateID(form.name),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      color: form.color,
      prompt: form.prompt.trim(),
      role: form.role.trim() || undefined,
      model,
      temperature: form.temperature ? parseFloat(form.temperature) : undefined,
      mcp,
      spawnable,
      idle_timeout: form.idle_timeout ? parseInt(form.idle_timeout, 10) : 120,
      order: props.existing?.order ?? 0,
    } as AgentDefinitionInfo

    try {
      const url = isEdit()
        ? `${props.serverUrl}/moose-agent/${props.existing!.id}`
        : `${props.serverUrl}/moose-agent`
      const method = isEdit() ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": props.directory,
        },
        body: JSON.stringify(isEdit() ? stripID(definition) : definition),
      })

      if (!res.ok) {
        const err = await res.text().catch(() => "Unknown error")
        throw new Error(err)
      }

      const saved: AgentDefinitionInfo = await res.json()
      props.onSaved?.(saved)
      props.onClose?.()
    } catch (err) {
      setSaving("error", err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving("active", false)
    }
  }

  function stripID(def: AgentDefinitionInfo) {
    const { id, ...rest } = def as any
    return rest
  }

  // Shared input class
  const inputClass =
    "h-8 px-3 rounded-md border border-border-base bg-background-base text-13-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-ring-base"

  // Shared checkbox toggle style
  const checkboxClass =
    "flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors hover:bg-surface-hover"

  return (
    <Dialog title={isEdit() ? "Edit Agent" : "Create Agent"} size="large">
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-1 py-2 max-h-[65vh] overflow-y-auto">
        {/* Name */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">Name *</label>
          <input
            type="text"
            value={form.name}
            onInput={(e) => setForm("name", e.currentTarget.value)}
            placeholder="e.g. Orchestrator, Coder, Researcher..."
            class={inputClass}
            autofocus
          />
        </div>

        {/* Color */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">Color *</label>
          <div class="flex items-center gap-2 flex-wrap">
            <For each={COLOR_PRESETS}>
              {(color) => (
                <button
                  type="button"
                  class="size-6 rounded-full border-2 transition-all hover:scale-110"
                  classList={{
                    "border-text-strong scale-110": form.color === color,
                    "border-transparent": form.color !== color,
                  }}
                  style={{ "background-color": color }}
                  onClick={() => setForm("color", color)}
                />
              )}
            </For>
            <input
              type="text"
              value={form.color}
              onInput={(e) => setForm("color", e.currentTarget.value)}
              placeholder="#FF6B35"
              class="w-20 h-6 px-2 rounded-md border border-border-base bg-background-base text-11-regular text-text-base font-mono focus:outline-none focus:ring-1 focus:ring-ring-base"
            />
            <div
              class="size-6 rounded-full border border-border-base"
              style={{ "background-color": form.color.match(/^#[0-9a-fA-F]{6}$/) ? form.color : "#666" }}
            />
          </div>
        </div>

        {/* Description */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">Description</label>
          <input
            type="text"
            value={form.description}
            onInput={(e) => setForm("description", e.currentTarget.value)}
            placeholder="Short description of what this agent does"
            class={inputClass}
          />
        </div>

        {/* System Prompt */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">System Prompt *</label>
          <textarea
            value={form.prompt}
            onInput={(e) => setForm("prompt", e.currentTarget.value)}
            placeholder="You are a specialized agent that..."
            rows={5}
            class="px-3 py-2 rounded-md border border-border-base bg-background-base text-13-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-ring-base resize-y font-mono"
          />
        </div>

        {/* Role */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">Role</label>
          <input
            type="text"
            value={form.role}
            onInput={(e) => setForm("role", e.currentTarget.value)}
            placeholder="e.g. code_writer, researcher, reviewer..."
            class={inputClass}
          />
        </div>

        {/* ═══ Model Selection ═══ */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">Model</label>
          <div class="flex gap-3">
            <div class="flex-1 flex flex-col gap-1">
              <span class="text-11-regular text-text-weak">Provider</span>
              <Show
                when={hasProviders()}
                fallback={
                  <input
                    type="text"
                    value={form.modelProviderID}
                    onInput={(e) => setForm("modelProviderID", e.currentTarget.value)}
                    placeholder="e.g. anthropic, openai"
                    class={inputClass}
                  />
                }
              >
                <select
                  value={form.modelProviderID}
                  onChange={(e) => {
                    setForm("modelProviderID", e.currentTarget.value)
                    // Reset model when provider changes
                    setForm("modelModelID", "")
                  }}
                  class={inputClass}
                >
                  <option value="">Select provider...</option>
                  <For each={sortedProviders()}>
                    {(p) => {
                      const isConnected = () => (props.connectedProviderIDs ?? []).includes(p.id)
                      return (
                        <option value={p.id}>
                          {p.name ?? p.id}{isConnected() ? " \u2713" : ""}
                        </option>
                      )
                    }}
                  </For>
                </select>
              </Show>
            </div>
            <div class="flex-1 flex flex-col gap-1">
              <span class="text-11-regular text-text-weak">Model ID</span>
              <Show
                when={hasProviders() && form.modelProviderID}
                fallback={
                  <input
                    type="text"
                    value={form.modelModelID}
                    onInput={(e) => setForm("modelModelID", e.currentTarget.value)}
                    placeholder="e.g. claude-sonnet-4-20250514"
                    class={inputClass}
                  />
                }
              >
                <select
                  value={form.modelModelID}
                  onChange={(e) => setForm("modelModelID", e.currentTarget.value)}
                  class={inputClass}
                >
                  <option value="">Select model...</option>
                  <For each={modelsForProvider()}>
                    {(m) => (
                      <option value={m.id}>{m.name}</option>
                    )}
                  </For>
                </select>
              </Show>
            </div>
          </div>
          <div class="text-11-regular text-text-weak">Leave blank to use the default model</div>
        </div>

        {/* Temperature + Idle Timeout — side by side */}
        <div class="flex gap-4">
          <div class="flex-1 flex flex-col gap-1.5">
            <label class="text-12-medium text-text-strong">Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperature}
              onInput={(e) => setForm("temperature", e.currentTarget.value)}
              placeholder="0.7"
              class={inputClass}
            />
          </div>
          <div class="flex-1 flex flex-col gap-1.5">
            <label class="text-12-medium text-text-strong">Idle Timeout (seconds)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={form.idle_timeout}
              onInput={(e) => setForm("idle_timeout", e.currentTarget.value)}
              placeholder="120"
              class={inputClass}
            />
            <div class="text-11-regular text-text-weak">0 = never auto-delete</div>
          </div>
        </div>

        {/* ═══ MCP Server Configuration ═══ */}
        <Show when={(props.mcpServerNames?.length ?? 0) > 0}>
          <div class="flex flex-col gap-1.5">
            <label class="text-12-medium text-text-strong">MCP Servers</label>
            <div class="flex flex-col gap-1.5 p-2 rounded-md border border-border-base bg-background-base">
              {/* All servers toggle */}
              <label
                class={checkboxClass}
                classList={{
                  "border-ring-base bg-surface-hover": form.mcpAllSelected,
                  "border-border-base": !form.mcpAllSelected,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.mcpAllSelected}
                  onChange={() => toggleMcpAllSelected()}
                  class="accent-ring-base"
                />
                <span class="text-12-regular text-text-strong">All servers (default)</span>
              </label>

              {/* Individual server toggles */}
              <Show when={!form.mcpAllSelected}>
                <div class="flex flex-col gap-1 pl-2">
                  <For each={props.mcpServerNames}>
                    {(name) => (
                      <label
                        class={checkboxClass}
                        classList={{
                          "border-ring-base bg-surface-hover": form.mcpServers.includes(name),
                          "border-border-base": !form.mcpServers.includes(name),
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={form.mcpServers.includes(name)}
                          onChange={() => toggleMcpServer(name)}
                          class="accent-ring-base"
                        />
                        <span class="text-12-regular text-text-base">{name}</span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>

              {/* Deny list */}
              <div class="flex flex-col gap-1 mt-1">
                <span class="text-11-regular text-text-weak">Deny specific tools (comma-separated)</span>
                <input
                  type="text"
                  value={form.mcpDeny}
                  onInput={(e) => setForm("mcpDeny", e.currentTarget.value)}
                  placeholder="e.g. dangerous_tool, shell_exec"
                  class="h-7 px-2.5 rounded-md border border-border-base bg-background-base text-12-regular text-text-base placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-ring-base"
                />
              </div>
            </div>
          </div>
        </Show>

        {/* ═══ Spawnable Agents Configuration ═══ */}
        <Show when={otherDefinitions().length > 0}>
          <div class="flex flex-col gap-1.5">
            <label class="text-12-medium text-text-strong">Spawnable Agents</label>
            <div class="flex flex-col gap-1.5 p-2 rounded-md border border-border-base bg-background-base">
              <For each={otherDefinitions()}>
                {(def) => (
                  <label
                    class={checkboxClass}
                    classList={{
                      "border-ring-base bg-surface-hover": form.spawnableAgents.includes(def.id),
                      "border-border-base": !form.spawnableAgents.includes(def.id),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.spawnableAgents.includes(def.id)}
                      onChange={() => toggleSpawnableAgent(def.id)}
                      class="accent-ring-base"
                    />
                    <span
                      class="size-3 rounded-full flex-shrink-0"
                      style={{ "background-color": def.color }}
                    />
                    <span class="text-12-regular text-text-base">{def.name}</span>
                  </label>
                )}
              </For>

              {/* Spawn limit */}
              <Show when={form.spawnableAgents.length > 0}>
                <div class="flex items-center gap-2 mt-1 pt-1.5 border-t border-border-base">
                  <span class="text-11-regular text-text-weak flex-shrink-0">Spawn limit:</span>
                  <input
                    type="text"
                    value={form.spawnableLimit}
                    onInput={(e) => setForm("spawnableLimit", e.currentTarget.value)}
                    placeholder='5 or "auto"'
                    class="w-20 h-7 px-2.5 rounded-md border border-border-base bg-background-base text-12-regular text-text-base placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-ring-base"
                  />
                  <span class="text-11-regular text-text-weak">max concurrent children</span>
                </div>
              </Show>
            </div>
            <div class="text-11-regular text-text-weak">Select which agent types this agent can spawn as children</div>
          </div>
        </Show>

        {/* Error message */}
        <Show when={saving.error}>
          <div class="px-3 py-2 rounded-md bg-surface-danger/10 border border-surface-danger text-12-regular text-text-danger">
            {saving.error}
          </div>
        </Show>

        {/* Actions */}
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-border-weak-base">
          <Button type="button" variant="ghost" size="small" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="small" disabled={!canSubmit() || saving.active}>
            {saving.active ? "Saving..." : isEdit() ? "Save Changes" : "Create Agent"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
