import { type Component, createMemo, For, Show } from "solid-js"
import type { AgentInstanceInfo, AgentMessage } from "@/context/canvas"

/** Radius of the agent node circle — connection lines start/end at the circle edge */
const NODE_RADIUS = 36

/** How long a message pulse stays visible (ms) — matches canvas store expiry */
const MESSAGE_PULSE_DURATION = 3000

export type AgentConnectionProps = {
  parent: AgentInstanceInfo
  child: AgentInstanceInfo
  active: boolean
  color?: string
  /** Recent messages on this connection (within last few seconds) */
  recentMessages?: AgentMessage[]
  /** Whether the child recently completed a task (triggers green flash) */
  taskComplete?: boolean
}

export const AgentConnection: Component<AgentConnectionProps> = (props) => {
  // Center of each node (node is positioned by its top-left corner)
  const parentCenter = createMemo(() => ({
    x: props.parent.positionX + NODE_RADIUS,
    y: props.parent.positionY + NODE_RADIUS,
  }))

  const childCenter = createMemo(() => ({
    x: props.child.positionX + NODE_RADIUS,
    y: props.child.positionY + NODE_RADIUS,
  }))

  // Shorten the line by NODE_RADIUS at each end so it starts/ends at the circle edge
  const lineCoords = createMemo(() => {
    const px = parentCenter().x
    const py = parentCenter().y
    const cx = childCenter().x
    const cy = childCenter().y

    const dx = cx - px
    const dy = cy - py
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < NODE_RADIUS * 2) {
      // Nodes overlap — just draw to centers
      return { x1: px, y1: py, x2: cx, y2: cy }
    }

    const nx = dx / dist
    const ny = dy / dist

    return {
      x1: px + nx * NODE_RADIUS,
      y1: py + ny * NODE_RADIUS,
      x2: cx - nx * NODE_RADIUS,
      y2: cy - ny * NODE_RADIUS,
    }
  })

  // Build SVG path string from the line coords (needed for animateMotion)
  const pathD = createMemo(() => {
    const c = lineCoords()
    return `M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`
  })

  // Reverse path (child→parent direction)
  const reversedPathD = createMemo(() => {
    const c = lineCoords()
    return `M ${c.x2} ${c.y2} L ${c.x1} ${c.y1}`
  })

  // Compute active pulses: recent messages within the pulse duration
  const activePulses = createMemo(() => {
    const msgs = props.recentMessages ?? []
    const now = Date.now()
    return msgs
      .filter((m) => now - m.timestamp < MESSAGE_PULSE_DURATION)
      .map((m) => ({
        key: `${m.fromInstanceID}-${m.timestamp}`,
        // Direction: from child to parent = use reversed path (child→parent)
        // from parent to child = use forward path (parent→child)
        toParent: m.fromInstanceID === props.child.id,
        type: m.type,
      }))
  })

  const hasActivePulses = createMemo(() => activePulses().length > 0)

  // Check if any active pulse is an instruction (parent→child: question or scope_request)
  const hasInstructionPulse = createMemo(() =>
    activePulses().some((p) => !p.toParent && (p.type === "question" || p.type === "scope_request")),
  )

  return (
    <g class="agent-connection" style={{ "--agent-color": props.color }}>
      {/* Main connection line */}
      <line
        x1={lineCoords().x1}
        y1={lineCoords().y1}
        x2={lineCoords().x2}
        y2={lineCoords().y2}
        classList={{
          active: props.active,
          pulsing: hasActivePulses() && !hasInstructionPulse() && !props.taskComplete,
          "instruction-sent": hasInstructionPulse(),
          "task-complete": !!props.taskComplete,
        }}
      />

      {/* Small dot at the child end */}
      <circle
        cx={lineCoords().x2}
        cy={lineCoords().y2}
        r="4"
        class="connection-dot"
        classList={{ active: props.active }}
      />

      {/* Message pulse animations */}
      <Show when={hasActivePulses()}>
        <For each={activePulses()}>
          {(pulse) => (
            <circle
              r="5"
              class={`message-pulse ${pulse.type}`}
            >
              <animateMotion
                dur="0.8s"
                repeatCount={1}
                fill="freeze"
                path={pulse.toParent ? reversedPathD() : pathD()}
              />
            </circle>
          )}
        </For>
      </Show>
    </g>
  )
}
