import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useCanvas, type AgentInstanceInfo, type AgentDefinitionInfo } from "@/context/canvas"

const STATE_LABELS: Record<string, string> = {
  idle: "idle",
  working: "working",
  error: "error",
  question: "question",
  spawning: "spawning",
}

/** Format seconds into a readable countdown string */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s"
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export const ActiveInstancesOverlay: Component = () => {
  const canvas = useCanvas()

  // Tick every second to update countdown timers
  const [tick, setTick] = createSignal(Date.now())
  onMount(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000)
    onCleanup(() => clearInterval(interval))
  })

  const instances = createMemo(() => canvas.instances)

  /** Get definition for an instance, with fallback */
  function defFor(inst: AgentInstanceInfo): AgentDefinitionInfo | undefined {
    return canvas.definitionFor(inst)
  }

  /** Calculate seconds remaining before GC for an idle child agent */
  function idleSecondsRemaining(inst: AgentInstanceInfo, def: AgentDefinitionInfo | undefined): number | undefined {
    // Top-level agents (no parent) are never auto-deleted
    if (!inst.parentInstanceID) return undefined
    // Working agents aren't timed
    if (inst.state === "working") return undefined
    const timeout = def?.idle_timeout ?? 120
    // 0 = never auto-delete
    if (timeout === 0) return undefined
    const lastActive = inst.timeLastActive ?? inst.time.created
    const now = tick()
    const elapsed = (now - lastActive) / 1000
    return Math.max(0, timeout - elapsed)
  }

  return (
    <Show when={instances().length > 0}>
      <div
        class="instances-overlay"
        onClick={(e: MouseEvent) => e.stopPropagation()}
        onContextMenu={(e: MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="instances-overlay-header">
          Active ({instances().length})
        </div>

        {/* Instance list */}
        <div class="flex flex-col">
          <For each={instances()}>
            {(inst) => {
              const def = () => defFor(inst)
              const stateLabel = () => STATE_LABELS[inst.state] ?? inst.state
              const isSelected = () => canvas.selectedID === inst.id
              const remaining = () => idleSecondsRemaining(inst, def())
              const hasTimer = () => remaining() !== undefined
              const isUrgent = () => {
                const r = remaining()
                return r !== undefined && r <= 30
              }

              return (
                <div
                  class={`instances-overlay-item ${isSelected() ? "selected" : ""}`}
                  onClick={() => canvas.select(inst.id)}
                >
                  {/* Color dot with glow */}
                  <div
                    class="instances-overlay-dot"
                    style={{
                      "background-color": def()?.color ?? "#888",
                      "--dot-color": def()?.color ?? "#888",
                    }}
                  />

                  {/* Name — shows displayName if assigned */}
                  <span class="instances-overlay-name">
                    {inst.displayName
                      ? `${def()?.name ?? inst.agentDefinitionID} — ${inst.displayName}`
                      : def()?.name ?? inst.agentDefinitionID}
                  </span>

                  {/* State label + countdown timer */}
                  <div class="flex items-center gap-1.5 ml-auto shrink-0">
                    {/* Countdown timer for idle child agents */}
                    <Show when={hasTimer() && inst.state === "idle"}>
                      <span
                        class="text-10-regular font-mono tabular-nums"
                        style={{
                          color: isUrgent() ? "#8b87a0" : "#6b6780",
                          animation: isUrgent() ? "pulse 1.5s ease-in-out infinite" : "none",
                        }}
                      >
                        {formatCountdown(remaining()!)}
                      </span>
                    </Show>

                    {/* State label */}
                    <span class={`instances-overlay-state ${inst.state}`}>
                      {stateLabel()}
                    </span>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
