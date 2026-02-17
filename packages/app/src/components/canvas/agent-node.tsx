import { type Component, createMemo, createSignal, onMount, Show } from "solid-js"
import type { AgentInstanceInfo, AgentDefinitionInfo } from "@/context/canvas"
import { getMooseIcon } from "./moose-icons"

/** Linearly interpolate between two hex colors */
function lerpColor(a: string, b: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t))
  const ar = parseInt(a.slice(1, 3), 16)
  const ag = parseInt(a.slice(3, 5), 16)
  const ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16)
  const bg = parseInt(b.slice(3, 5), 16)
  const bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * clamp)
  const g = Math.round(ag + (bg - ag) * clamp)
  const bl = Math.round(ab + (bb - ab) * clamp)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`
}

const STATE_EMOJI: Record<string, string> = {
  idle: "",
  working: "",
  error: "",
  question: "",
  spawning: "",
}

/** SVG ring dimensions — the ring wraps around the 72px agent circle */
const RING_SIZE = 82
const RING_CENTER = RING_SIZE / 2
const RING_RADIUS = 38
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export type AgentNodeProps = {
  instance: AgentInstanceInfo
  definition: AgentDefinitionInfo | undefined
  selected: boolean
  gcWarning: boolean
  /** Whether this agent recently completed a task (green glow animation) */
  taskComplete?: boolean
  /** Context usage percentage (0–100), undefined if no data */
  contextUsage?: number
  /** Todo progress: { completed, total } or undefined if no todos */
  todoProgress?: { completed: number; total: number }
  onPointerDown: (e: PointerEvent) => void
  onClick: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
}

export const AgentNode: Component<AgentNodeProps> = (props) => {
  const color = createMemo(() => props.definition?.color ?? "#888888")
  const name = createMemo(() => props.definition?.name ?? props.instance.agentDefinitionID)
  const role = createMemo(() => props.definition?.role)
  const state = createMemo(() => props.instance.state)

  // Play liquid spawn-enter animation when node first mounts (if recently created)
  const [spawnEnter, setSpawnEnter] = createSignal(false)
  onMount(() => {
    const age = Date.now() - props.instance.time.created
    if (age < 5000) {
      // Node was created in the last 5 seconds — play spawn animation
      setSpawnEnter(true)
      setTimeout(() => setSpawnEnter(false), 2500) // matches animation duration
    }
  })

  /** Get the role-specific moose icon component */
  const MooseIcon = createMemo(() => getMooseIcon(role()))

  const stateClass = createMemo(() => {
    switch (state()) {
      case "working":
        return "state-working"
      case "error":
        return "state-error"
      case "question":
        return "state-question"
      case "spawning":
        return "state-spawning"
      default:
        return ""
    }
  })

  /** Progress ring dash offset (0 = full, circumference = empty) */
  const ringOffset = createMemo(() => {
    const usage = props.contextUsage ?? 0
    const clamped = Math.max(0, Math.min(100, usage))
    return RING_CIRCUMFERENCE * (1 - clamped / 100)
  })

  /** Ring color smoothly blends green → amber → red based on context usage.
   *  0–50% = green (#22c55e), 50–80% = blends green→amber, 80–100% = blends amber→red */
  const ringColor = createMemo(() => {
    const usage = props.contextUsage ?? 0
    if (usage <= 50) return "#22c55e" // pure green
    if (usage <= 80) {
      // Blend green → amber (50% → 80%)
      const t = (usage - 50) / 30 // 0 at 50%, 1 at 80%
      return lerpColor("#22c55e", "#f59e0b", t)
    }
    // Blend amber → red (80% → 100%)
    const t = Math.min(1, (usage - 80) / 20) // 0 at 80%, 1 at 100%
    return lerpColor("#f59e0b", "#ef4444", t)
  })

  return (
    <div
      class={`agent-node ${stateClass()} ${props.selected ? "selected" : ""} ${props.gcWarning ? "gc-warning" : ""} ${props.taskComplete ? "task-complete" : ""} ${spawnEnter() ? "spawn-enter" : ""}`}
      style={{
        left: `${props.instance.positionX}px`,
        top: `${props.instance.positionY}px`,
        "--agent-color": color(),
      }}
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      <div class="agent-node-circle" style={{ "border-color": color() }}>
        {/* Role-specific moose icon */}
        {(() => {
          const Icon = MooseIcon()
          return <Icon size={42} color={color()} />
        })()}

        {/* Context usage ring — overlays the circle border */}
        <Show when={props.contextUsage != null && props.contextUsage > 0}>
          <svg
            class="agent-context-ring"
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          >
            {/* Background track (dim version of the progress color) */}
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke={ringColor()}
              stroke-width="3"
              opacity="0.15"
              style={{ transition: "stroke 0.5s ease" }}
            />
            {/* Progress arc */}
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke={ringColor()}
              stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray={RING_CIRCUMFERENCE.toString()}
              stroke-dashoffset={ringOffset()}
              transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.5s ease" }}
            />
          </svg>
        </Show>

        {/* State badge */}
        <Show when={state() !== "idle"}>
          <div class={`agent-state-badge ${state()}`}>
            <span>{STATE_EMOJI[state()] ?? ""}</span>
          </div>
        </Show>

        {/* Error badge — red "!" above-right of the circle */}
        <Show when={state() === "error"}>
          <div class="agent-error-badge">!</div>
        </Show>

        {/* Todo progress badge — top-left of circle */}
        <Show when={props.todoProgress && props.todoProgress.total > 0}>
          <div
            class="agent-todo-badge"
            classList={{
              "todo-done": props.todoProgress!.completed === props.todoProgress!.total,
            }}
          >
            {props.todoProgress!.completed}/{props.todoProgress!.total}
          </div>
        </Show>
      </div>

      <div class="agent-node-label">
        {props.instance.displayName ? `${name()} — ${props.instance.displayName}` : name()}
      </div>
      <Show when={role()}>
        <div class="agent-node-role">{role()}</div>
      </Show>
    </div>
  )
}
