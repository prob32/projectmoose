import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import type { Message, Part, ToolPart, SubtaskPart } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { PromptInput } from "@/components/prompt-input"
import { QuestionDock } from "@/components/question-dock"
import { questionSubtitle } from "@/pages/session/session-prompt-helpers"
import { useCanvas, type AgentDefinitionInfo, type AgentInstanceInfo } from "@/context/canvas"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useParams } from "@solidjs/router"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"

/** Human-readable tool name labels */
const TOOL_LABELS: Record<string, string> = {
  bash: "Terminal",
  read: "Read File",
  write: "Write File",
  edit: "Edit File",
  glob: "Find Files",
  grep: "Search",
  task: "Subagent Task",
  todoread: "Read Todos",
  todowrite: "Write Todos",
  web_search: "Web Search",
  web_fetch: "Web Fetch",
}

/** Collapsible tool call display for the agent chat panel */
function ToolCallBubble(props: { part: ToolPart }) {
  const [expanded, setExpanded] = createSignal(false)
  const label = () => TOOL_LABELS[props.part.tool] ?? props.part.tool
  const status = () => props.part.state?.status ?? "pending"
  const title = () => ("title" in props.part.state ? props.part.state.title : undefined) as string | undefined
  const output = () => ("output" in props.part.state ? props.part.state.output : undefined) as string | undefined
  const isError = () => status() === "error"
  const errorMsg = () => ("error" in props.part.state ? props.part.state.error : undefined) as string | undefined

  return (
    <div
      class="self-start w-full rounded-md border overflow-hidden transition-colors"
      style={{
        "border-color": isError() ? "rgba(239, 68, 68, 0.3)" : "rgba(139, 92, 246, 0.15)",
        background: isError() ? "rgba(239, 68, 68, 0.05)" : "rgba(139, 92, 246, 0.04)",
      }}
    >
      {/* Header — always visible, clickable to expand */}
      <button
        class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer transition-colors"
        style={{ background: "transparent" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)" }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        onClick={() => setExpanded(!expanded())}
      >
        {/* Status indicator */}
        <span
          class="shrink-0 size-1.5 rounded-full"
          style={{
            background: isError() ? "#ef4444" : status() === "completed" ? "#22c55e" : status() === "running" ? "#eab308" : "#8b87a0",
          }}
        />
        {/* Tool name */}
        <span style={{ color: "#8b87a0", "font-size": "11px", "font-weight": "600", "letter-spacing": "0.02em" }}>
          {label()}
        </span>
        {/* Title / description */}
        <Show when={title()}>
          <span class="truncate" style={{ color: "#6b6780", "font-size": "11px" }}>
            — {title()}
          </span>
        </Show>
        {/* Expand arrow */}
        <span
          class="shrink-0 ml-auto transition-transform"
          style={{
            color: "#6b6780",
            "font-size": "10px",
            transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▸
        </span>
      </button>

      {/* Expanded content */}
      <Show when={expanded()}>
        <div
          class="px-2.5 py-2 text-11-regular font-mono overflow-x-auto"
          style={{
            "border-top": "1px solid rgba(139, 92, 246, 0.1)",
            color: "#6b6780",
            "max-height": "200px",
            "overflow-y": "auto",
            "white-space": "pre-wrap",
            "word-break": "break-all",
          }}
        >
          <Show when={isError() && errorMsg()}>
            <div style={{ color: "#ef4444", "margin-bottom": "4px" }}>{errorMsg()}</div>
          </Show>
          <Show when={output()}>
            <div>{output()!.length > 2000 ? output()!.slice(0, 2000) + "…" : output()}</div>
          </Show>
          <Show when={!output() && !errorMsg()}>
            <div style={{ color: "#6b6780", "font-style": "italic" }}>
              {status() === "running" ? "Running…" : status() === "pending" ? "Pending…" : "No output"}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** Lightweight chat bubble for the agent chat panel */
function ChatBubble(props: { message: Message; parts: Part[]; agentColor?: string }) {
  const isUser = () => props.message.role === "user"

  // Separate text parts and tool parts
  const textParts = createMemo(() => props.parts.filter((p) => p.type === "text" && "text" in p))
  const toolParts = createMemo(() => props.parts.filter((p) => p.type === "tool") as ToolPart[])
  const subtaskParts = createMemo(() => props.parts.filter((p) => p.type === "subtask") as SubtaskPart[])
  const hasContent = createMemo(() => textParts().length > 0 || toolParts().length > 0 || subtaskParts().length > 0)

  // Agent color border for assistant messages
  const borderColor = () =>
    !isUser() && props.agentColor ? props.agentColor : undefined

  return (
    <div class="flex flex-col gap-1.5 max-w-[90%]" classList={{ "self-end": isUser(), "self-start": !isUser() }}>
      {/* Text content bubble */}
      <Show when={textParts().length > 0}>
        <div
          classList={{
            "flex flex-col gap-1 px-3 py-2 rounded-lg text-13-regular": true,
            "bg-surface-base text-text-strong": isUser(),
            "text-text-base": !isUser(),
          }}
          style={{
            ...(borderColor()
              ? {
                  "border-left": `3px solid ${borderColor()}`,
                  background: `color-mix(in srgb, ${borderColor()!} 6%, transparent)`,
                  "padding-left": "10px",
                }
              : !isUser()
                ? {
                    background: "rgba(139, 92, 246, 0.04)",
                    border: "1px solid rgba(139, 92, 246, 0.1)",
                  }
                : {}),
          }}
        >
          <For each={textParts()}>
            {(part) => <div class="whitespace-pre-wrap break-words">{(part as { text: string }).text}</div>}
          </For>
        </div>
      </Show>

      {/* Subtask parts (agent delegation) */}
      <For each={subtaskParts()}>
        {(part) => (
          <div
            class="self-start flex items-center gap-2 px-2.5 py-1.5 rounded-md"
            style={{
              background: "rgba(139, 92, 246, 0.06)",
              border: "1px solid rgba(139, 92, 246, 0.15)",
            }}
          >
            <span style={{ color: "#8b5cf6", "font-size": "11px", "font-weight": "600" }}>⚡ Task</span>
            <span class="truncate" style={{ color: "#8b87a0", "font-size": "11px" }}>
              {part.description} → @{part.agent}
            </span>
          </div>
        )}
      </For>

      {/* Tool call parts — expandable */}
      <Show when={toolParts().length > 0}>
        <div class="flex flex-col gap-1 w-full">
          <For each={toolParts()}>
            {(part) => <ToolCallBubble part={part} />}
          </For>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!hasContent() && props.parts.length === 0}>
        <div class="px-3 py-2 text-text-weak text-12-regular italic">...</div>
      </Show>
    </div>
  )
}

/** Inline agent picklist — reuses QuestionDock styling via data-component/data-slot attributes */
function AgentPicker(props: {
  question: string
  options: Array<{ instance?: AgentInstanceInfo; definition: AgentDefinitionInfo }>
  onSelect: (option: { instance?: AgentInstanceInfo; definition: AgentDefinitionInfo }) => void
  onDismiss: () => void
}) {
  return (
    <div data-component="question-prompt">
      <div data-slot="question-content">
        <div data-slot="question-text">{props.question}</div>
        <div data-slot="question-options">
          <For each={props.options}>
            {(opt) => (
              <button data-slot="question-option" onClick={() => props.onSelect(opt)}>
                <span data-slot="option-label">
                  <span
                    class="inline-block size-2.5 rounded-full mr-1.5"
                    style={{ background: opt.definition.color }}
                  />
                  {opt.definition.name}
                </span>
                <Show when={opt.definition.description}>
                  <span data-slot="option-description">{opt.definition.description}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
      <div data-slot="question-actions">
        <Button variant="ghost" size="small" onClick={props.onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

/** Two-step task assigner: pick child agent → type task → confirm & send */
function TaskAssigner(props: {
  options: Array<{ instance: AgentInstanceInfo; definition: AgentDefinitionInfo }>
  onSubmit: (instance: AgentInstanceInfo, taskText: string) => void
  onDismiss: () => void
}) {
  const [store, setStore] = createStore({
    tab: 0 as number, // 0=agent, 1=task, 2=confirm
    selectedAgent: null as null | { instance: AgentInstanceInfo; definition: AgentDefinitionInfo },
    taskText: "",
  })

  const isConfirm = () => store.tab === 2

  const pickAgent = (opt: { instance: AgentInstanceInfo; definition: AgentDefinitionInfo }) => {
    setStore("selectedAgent", opt)
    setStore("tab", 1) // auto-advance to task input
  }

  const handleTaskSubmit = (e: Event) => {
    e.preventDefault()
    if (!store.taskText.trim()) return
    setStore("tab", 2) // advance to confirm
  }

  const submit = () => {
    if (!store.selectedAgent || !store.taskText.trim()) return
    props.onSubmit(store.selectedAgent.instance, store.taskText.trim())
  }

  return (
    <div data-component="question-prompt">
      {/* Tab bar */}
      <div data-slot="question-tabs">
        <button
          data-slot="question-tab"
          data-active={store.tab === 0}
          data-answered={!!store.selectedAgent}
          onClick={() => setStore("tab", 0)}
        >
          Agent
        </button>
        <button
          data-slot="question-tab"
          data-active={store.tab === 1}
          data-answered={!!store.taskText.trim()}
          onClick={() => setStore("tab", 1)}
        >
          Task
        </button>
        <button
          data-slot="question-tab"
          data-active={isConfirm()}
          onClick={() => setStore("tab", 2)}
        >
          Confirm
        </button>
      </div>

      {/* Tab 0: Agent selection */}
      <Show when={store.tab === 0}>
        <div data-slot="question-content">
          <div data-slot="question-text">Which agent should receive this task?</div>
          <div data-slot="question-options">
            <For each={props.options}>
              {(opt) => (
                <button
                  data-slot="question-option"
                  data-picked={store.selectedAgent?.instance.id === opt.instance.id}
                  onClick={() => pickAgent(opt)}
                >
                  <span data-slot="option-label">
                    <span
                      class="inline-block size-2.5 rounded-full mr-1.5"
                      style={{ background: opt.definition.color }}
                    />
                    {opt.definition.name}
                  </span>
                  <Show when={opt.definition.description}>
                    <span data-slot="option-description">{opt.definition.description}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Tab 1: Task input */}
      <Show when={store.tab === 1}>
        <div data-slot="question-content">
          <div data-slot="question-text">
            Describe the task for {store.selectedAgent?.definition.name ?? "agent"}:
          </div>
          <form data-slot="custom-input-form" onSubmit={handleTaskSubmit}>
            <input
              ref={(el) => setTimeout(() => el.focus(), 0)}
              type="text"
              data-slot="custom-input"
              placeholder="e.g., Research the latest Node.js security updates"
              value={store.taskText}
              onInput={(e) => setStore("taskText", e.currentTarget.value)}
            />
            <Button type="submit" variant="primary" size="small" disabled={!store.taskText.trim()}>
              Next
            </Button>
          </form>
        </div>
      </Show>

      {/* Tab 2: Confirm */}
      <Show when={isConfirm()}>
        <div data-slot="question-review">
          <div data-slot="review-title">Review Task Assignment</div>
          <div data-slot="review-item">
            <span data-slot="review-label">Agent</span>
            <span data-slot="review-value" data-answered={!!store.selectedAgent}>
              {store.selectedAgent?.definition.name ?? "Not selected"}
            </span>
          </div>
          <div data-slot="review-item">
            <span data-slot="review-label">Task</span>
            <span data-slot="review-value" data-answered={!!store.taskText.trim()}>
              {store.taskText.trim() || "Not entered"}
            </span>
          </div>
        </div>
      </Show>

      {/* Actions */}
      <div data-slot="question-actions">
        <Button variant="ghost" size="small" onClick={props.onDismiss}>
          Dismiss
        </Button>
        <Show when={isConfirm()}>
          <Button
            variant="primary"
            size="small"
            onClick={submit}
            disabled={!store.selectedAgent || !store.taskText.trim()}
          >
            Assign Task
          </Button>
        </Show>
      </div>
    </div>
  )
}

/** Group Chat Panel — shared conversation between multiple lasso-selected agents */
function GroupChatPanel() {
  const canvas = useCanvas()
  const sync = useSync()
  const sdk = useSDK()
  const [inputText, setInputText] = createSignal("")

  const group = () => canvas.groupChat
  const sessionID = () => group()?.sessionID

  // Load messages for the group session
  createEffect(() => {
    const sid = sessionID()
    if (sid) {
      sync.session.message(sid)
    }
  })

  const messages = createMemo(() => {
    const sid = sessionID()
    if (!sid) return []
    return sync.data.message[sid] ?? []
  })

  const partsFor = (messageID: string) => {
    const sid = sessionID()
    if (!sid) return []
    return sync.data.part[sid]?.[messageID] ?? []
  }

  // Resolve member instances + definitions
  const members = createMemo(() => {
    const g = group()
    if (!g) return []
    return g.memberInstanceIDs
      .map((id) => {
        const inst = canvas.instances.find((i) => i.id === id)
        if (!inst) return undefined
        const def = canvas.definitionFor(inst)
        return { instance: inst, definition: def }
      })
      .filter(Boolean) as Array<{ instance: AgentInstanceInfo; definition: AgentDefinitionInfo | undefined }>
  })

  // Resolve agent color from a message's `agent` field
  function agentColorForMessage(msg: Message): string | undefined {
    const agentID = (msg as any).agent as string | undefined
    if (!agentID) return undefined
    const member = members().find((m) => (m.definition?.id ?? m.instance.agentDefinitionID) === agentID)
    return member?.definition?.color
  }

  function agentNameForMessage(msg: Message): string | undefined {
    const agentID = (msg as any).agent as string | undefined
    if (!agentID) return undefined
    const member = members().find((m) => (m.definition?.id ?? m.instance.agentDefinitionID) === agentID)
    return member?.definition?.name ?? agentID
  }

  // Current responding agent info
  const currentAgent = createMemo(() => {
    const g = group()
    if (!g || g.status !== "running") return undefined
    return members()[g.currentAgentIndex]
  })

  async function handleSend() {
    const text = inputText().trim()
    if (!text || !group()) return
    setInputText("")

    // Import dynamically to avoid circular deps
    const { startRoundRobin } = await import("@/components/canvas/group-chat-orchestrator")
    startRoundRobin(text, {
      client: sdk.client,
      syncData: sync.data,
      canvas: {
        instances: canvas.instances,
        groupChat: canvas.groupChat!,
        definitionFor: canvas.definitionFor,
        setGroupChatStatus: canvas.setGroupChatStatus,
      },
    })
  }

  async function handleStop() {
    const { abortRoundRobin } = await import("@/components/canvas/group-chat-orchestrator")
    abortRoundRobin({
      client: sdk.client,
      canvas: {
        groupChat: canvas.groupChat!,
        setGroupChatStatus: canvas.setGroupChatStatus,
      } as any,
    })
  }

  function handleClose() {
    handleStop()
    canvas.clearGroupChat()
  }

  // Auto-scroll ref
  let scrollRef: HTMLDivElement | undefined
  createEffect(() => {
    // Trigger on messages change
    messages()
    if (scrollRef) {
      setTimeout(() => scrollRef!.scrollTo({ top: scrollRef!.scrollHeight, behavior: "smooth" }), 50)
    }
  })

  return (
    <Show when={group()}>
      <div class="flex-1 min-h-0 flex flex-col pointer-events-auto border-t border-border-weak-base bg-background-stronger/95 backdrop-blur-sm">
        {/* Header */}
        <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border-weak-base">
          <div class="flex items-center gap-2">
            <span class="text-12-medium text-text-strong">Group Chat</span>
            <div class="flex items-center gap-1">
              <For each={members()}>
                {(m) => (
                  <div
                    class="size-2 rounded-full"
                    style={{ "background-color": m.definition?.color ?? "#666" }}
                    title={m.definition?.name ?? m.instance.agentDefinitionID}
                  />
                )}
              </For>
            </div>
            <span class="text-11-regular text-text-weak">
              {members().length} agents
            </span>
          </div>
          <div class="flex items-center gap-2">
            {/* Progress indicator */}
            <Show when={group()!.status === "running" && currentAgent()}>
              <div class="flex items-center gap-1.5 text-11-regular text-text-weak animate-pulse">
                <div
                  class="size-2 rounded-full"
                  style={{ "background-color": currentAgent()!.definition?.color ?? "#666" }}
                />
                <span>
                  {currentAgent()!.definition?.name ?? "Agent"} responding...
                  ({group()!.currentAgentIndex + 1}/{group()!.memberInstanceIDs.length})
                </span>
              </div>
            </Show>
            <button
              classList={{
                "h-6 px-2 flex items-center gap-1 rounded-md text-11-medium border transition-colors": true,
                "text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30": group()!.status === "running",
                "text-text-weak hover:text-text-strong hover:bg-surface-base-hover border-border-weak-base": group()!.status !== "running",
              }}
              onClick={group()!.status === "running" ? handleStop : handleClose}
              aria-label={group()!.status === "running" ? "Stop round-robin" : "Close group chat"}
            >
              <Icon name="close" class="size-3" />
              {group()!.status === "running" ? "Stop" : "Close"}
            </button>
          </div>
        </div>

        {/* Messages scroll area */}
        <div ref={scrollRef} class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <Show
            when={messages().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-8 text-center">
                <div class="text-12-regular text-text-weak">Group chat created</div>
                <div class="text-11-regular text-text-weak mt-1">
                  Type a prompt below — each agent will respond in turn
                </div>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              <For each={messages()}>
                {(msg) => {
                  const color = () => agentColorForMessage(msg)
                  const name = () => agentNameForMessage(msg)
                  return (
                    <div>
                      <Show when={msg.role === "assistant" && name()}>
                        <div
                          class="text-10-medium mb-0.5 px-1"
                          style={{ color: color() ?? "#8b87a0" }}
                        >
                          {name()}
                        </div>
                      </Show>
                      <ChatBubble message={msg} parts={partsFor(msg.id)} agentColor={color()} />
                    </div>
                  )
                }}
              </For>

              {/* Working indicator */}
              <Show when={group()!.status === "running"}>
                <div class="flex items-center gap-2 px-3 py-2 mt-2 rounded-md border border-purple-500/30 bg-purple-500/5">
                  <div
                    class="size-2 rounded-full"
                    style={{ "background-color": currentAgent()?.definition?.color ?? "#8b5cf6" }}
                  />
                  <span class="text-purple-400 text-12-medium animate-pulse">
                    {currentAgent()?.definition?.name ?? "Agent"} is thinking...
                  </span>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {/* Input area */}
        <div class="shrink-0 px-4 py-3 border-t border-border-weak-base">
          <div class="flex items-center gap-2">
            <input
              type="text"
              class="flex-1 h-8 px-3 rounded-md bg-surface-base border border-border-weak-base text-13-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:border-purple-500/50"
              placeholder={
                group()!.status === "running"
                  ? "Waiting for agents..."
                  : "Send a prompt to all agents..."
              }
              value={inputText()}
              onInput={(e) => setInputText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={group()!.status === "running"}
            />
            <button
              class="h-8 px-3 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-12-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={group()!.status === "running" || !inputText().trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}

/** Collapsible todo list for the selected agent's session */
function AgentTodoPanel(props: { sessionID: string; agentColor?: string }) {
  const sync = useSync()
  const [expanded, setExpanded] = createSignal(true)

  // Trigger initial todo fetch
  createEffect(() => {
    sync.session.todo(props.sessionID)
  })

  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const completed = createMemo(() => todos().filter((t) => t.status === "completed").length)

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "\u2713"
      case "in_progress":
        return "\u25B8"
      case "cancelled":
        return "\u2715"
      default:
        return "\u25CB" // pending
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#22c55e"
      case "in_progress":
        return "#eab308"
      case "cancelled":
        return "#6b6780"
      default:
        return "#8b87a0"
    }
  }

  return (
    <Show when={todos().length > 0}>
      <div class="shrink-0 border-b border-border-weak-base">
        {/* Toggle header */}
        <button
          class="w-full flex items-center gap-2 px-4 py-1.5 text-left transition-colors hover:bg-surface-base-hover"
          onClick={() => setExpanded(!expanded())}
        >
          <span
            class="text-10-medium shrink-0 transition-transform"
            style={{
              color: "#8b87a0",
              transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            {"\u25B8"}
          </span>
          <span class="text-11-medium text-text-weak">Tasks</span>
          <span class="text-11-regular text-text-weaker">
            {completed()}/{todos().length}
          </span>
          {/* Inline progress bar */}
          <div
            class="flex-1 h-1 rounded-full bg-surface-base ml-2 mr-1 overflow-hidden"
            style={{ "max-width": "80px" }}
          >
            <div
              class="h-full rounded-full transition-all"
              style={{
                width: `${todos().length > 0 ? (completed() / todos().length) * 100 : 0}%`,
                background: completed() === todos().length ? "#22c55e" : (props.agentColor ?? "#8b5cf6"),
              }}
            />
          </div>
        </button>

        {/* Expanded todo list */}
        <Show when={expanded()}>
          <div class="px-4 pb-2 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            <For each={todos()}>
              {(todo) => (
                <div class="flex items-start gap-2 py-0.5">
                  <span
                    class="shrink-0 text-11-medium mt-px"
                    style={{ color: statusColor(todo.status), width: "12px", "text-align": "center" }}
                  >
                    {statusIcon(todo.status)}
                  </span>
                  <span
                    class="text-11-regular break-words"
                    classList={{
                      "text-text-base": todo.status === "in_progress" || todo.status === "pending",
                      "text-text-weak line-through": todo.status === "completed",
                      "text-text-weaker line-through": todo.status === "cancelled",
                    }}
                  >
                    {todo.content}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export function SessionPromptDock(props: {
  centered: boolean
  questionRequest: () => QuestionRequest | undefined
  permissionRequest: () => { patterns: string[]; permission: string } | undefined
  blocked: boolean
  promptReady: boolean
  handoffPrompt?: string
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const canvas = useCanvas()
  const sync = useSync()
  const sdk = useSDK()
  const params = useParams()

  // Selected agent and its session messages
  const selectedAgent = () => canvas.selected()
  const agentSessionID = () => selectedAgent()?.sessionID
  const agentDef = () => {
    const agent = selectedAgent()
    if (!agent) return undefined
    return canvas.definitionFor(agent)
  }

  // Sync agent session messages when a new agent is selected
  createEffect(() => {
    const sid = agentSessionID()
    if (!sid) return
    // Trigger sync to load messages from backend (SSE may also deliver them in real-time)
    sync.session.sync(sid)
  })

  const messages = createMemo(() => {
    const sid = agentSessionID()
    if (!sid) return []
    return sync.data.message[sid] ?? []
  })

  const partsFor = (messageID: string): Part[] => {
    return sync.data.part[messageID] ?? []
  }

  // Detect pending questions on the selected agent's session (inter-agent Q&A)
  const agentQuestion = createMemo(() => {
    const sid = agentSessionID()
    if (!sid) return undefined
    return sync.data.question?.[sid]?.[0]
  })

  // Detect pending permissions on the selected agent's session
  const agentPermission = createMemo(() => {
    const sid = agentSessionID()
    if (!sid) return undefined
    return sync.data.permission?.[sid]?.[0]
  })

  // Agent session metrics (tokens, cost, context usage)
  const metrics = createMemo(() => getSessionContextMetrics(messages(), sync.data.provider.all))
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => {
    const c = metrics().totalCost
    return c > 0 ? `$${c.toFixed(4)}` : undefined
  })

  // Auto-scroll to bottom when new messages arrive
  let scrollAnchor: HTMLDivElement | undefined

  createEffect(() => {
    const count = messages().length
    if (count > 0 && scrollAnchor) {
      // Small delay to let DOM render
      requestAnimationFrame(() => {
        scrollAnchor?.scrollIntoView({ behavior: "smooth" })
      })
    }
  })

  // ===== Inline spawn/task picker state =====
  const [pickerMode, setPickerMode] = createSignal<"spawn" | "task" | null>(null)

  onMount(() => {
    const handleSpawn = () => setPickerMode("spawn")
    const handleTask = () => setPickerMode("task")
    window.addEventListener("moose:spawn-request", handleSpawn)
    window.addEventListener("moose:task-request", handleTask)
    onCleanup(() => {
      window.removeEventListener("moose:spawn-request", handleSpawn)
      window.removeEventListener("moose:task-request", handleTask)
    })
  })

  // Find the parent instance (first instance with spawnable config)
  const parentInstance = createMemo(() => {
    for (const inst of canvas.instances) {
      const def = canvas.definitionFor(inst)
      if (def?.spawnable?.agents?.length) return inst
    }
    return undefined
  })

  // Spawnable agent definitions (for /spawn picker)
  const spawnOptions = createMemo(() => {
    const parent = parentInstance()
    if (!parent) return []
    const parentDef = canvas.definitionFor(parent)
    if (!parentDef?.spawnable?.agents?.length) return []
    const allowed = new Set(parentDef.spawnable.agents)
    return canvas.definitions
      .filter((d) => allowed.has(d.id))
      .map((d) => ({ definition: d }))
  })

  // Existing child instances (for /task picker)
  const taskOptions = createMemo(() => {
    const parent = parentInstance()
    if (!parent) return []
    return canvas.instances
      .filter((inst) => inst.parentInstanceID === parent.id)
      .map((inst) => {
        const def = canvas.definitionFor(inst)
        return def ? { instance: inst, definition: def } : undefined
      })
      .filter(Boolean) as Array<{ instance: AgentInstanceInfo; definition: AgentDefinitionInfo }>
  })

  async function handleSpawnSelect(opt: { definition: AgentDefinitionInfo }) {
    const parent = parentInstance()
    if (!parent) return
    setPickerMode(null)

    const workspaceSessionID = params.dir ?? ""
    const child = await canvas.spawnChild(parent.id, opt.definition.id, workspaceSessionID)
    if (child) {
      canvas.select(child.id)
    }
  }

  async function handleTaskAssign(instance: AgentInstanceInfo, taskText: string) {
    setPickerMode(null)
    // Select the child on canvas to show its chat panel
    canvas.select(instance.id)
    // Send the task as a prompt to the child's session
    const childSessionID = instance.sessionID
    if (childSessionID) {
      // Set child to "working" state before sending the prompt
      await canvas.setInstanceState(instance.id, "working")

      // Resolve agent/model from the child's definition (so the correct prompt + model are used)
      const childDef = canvas.definitionFor(instance)
      const agentName = childDef?.id ?? instance.agentDefinitionID
      const model = childDef?.model ? { providerID: childDef.model.providerID, modelID: childDef.model.modelID } : undefined

      try {
        await sdk.client.session.promptAsync({
          sessionID: childSessionID,
          parts: [{ type: "text" as const, text: taskText }],
          agent: agentName,
          ...(model ? { model } : {}),
        })
        // Note: session.status SSE event (busy → idle) will auto-reset agent state
        // via the canvas context's session.status handler
      } catch {
        // Reset to error state on failure
        await canvas.setInstanceState(instance.id, "error")
      }
    }
  }

  return (
    <div
      ref={props.setPromptDockRef}
      class="absolute inset-x-0 bottom-0 flex flex-col justify-end z-50 pointer-events-none"
      style={{ "max-height": selectedAgent() || canvas.groupChat ? "45vh" : undefined }}
    >
      {/* Group chat panel — takes priority over single-agent panel */}
      <Show when={canvas.groupChat}>
        <GroupChatPanel />
      </Show>

      {/* Agent chat panel — expands upward when an agent is selected (hidden when group chat is active) */}
      <Show when={agentSessionID() && !canvas.groupChat}>
        <div class="flex-1 min-h-0 flex flex-col pointer-events-auto border-t border-border-weak-base bg-background-stronger/95 backdrop-blur-sm">
          {/* Agent header bar */}
          <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border-weak-base">
            <div class="flex items-center gap-2">
              <div
                class="size-2.5 rounded-full shrink-0"
                style={{ "background-color": agentDef()?.color ?? "#666" }}
              />
              <span class="text-12-medium text-text-strong">
                {agentDef()?.name ?? selectedAgent()?.agentDefinitionID ?? "Agent"}
                <Show when={selectedAgent()?.displayName}>
                  <span class="text-11-regular text-text-weak"> — {selectedAgent()!.displayName}</span>
                </Show>
              </span>
              <Show when={selectedAgent()?.state && selectedAgent()!.state !== "idle"}>
                <span class="text-11-regular text-text-weak capitalize">
                  {selectedAgent()!.state}
                </span>
              </Show>
            </div>
            <div class="flex items-center gap-3">
              {/* Metrics: donut + tokens + cost */}
              <Show when={context()}>
                {(ctx) => (
                  <Tooltip
                    value={
                      <div class="flex flex-col gap-0.5">
                        <div class="flex items-center gap-2">
                          <span class="text-text-invert-strong">{ctx().total.toLocaleString()}</span>
                          <span class="text-text-invert-base">tokens</span>
                        </div>
                        <Show when={ctx().usage != null}>
                          <div class="flex items-center gap-2">
                            <span class="text-text-invert-strong">{ctx().usage}%</span>
                            <span class="text-text-invert-base">context</span>
                          </div>
                        </Show>
                        <Show when={cost()}>
                          <div class="flex items-center gap-2">
                            <span class="text-text-invert-strong">{cost()}</span>
                            <span class="text-text-invert-base">cost</span>
                          </div>
                        </Show>
                      </div>
                    }
                    placement="top"
                  >
                    <div class="flex items-center gap-1.5 text-11-regular text-text-weak">
                      <ProgressCircle size={14} strokeWidth={2} percentage={ctx().usage ?? 0} />
                      <span>{ctx().total.toLocaleString()}</span>
                      <Show when={cost()}>
                        <span class="text-text-weaker">•</span>
                        <span>{cost()}</span>
                      </Show>
                    </div>
                  </Tooltip>
                )}
              </Show>
              <Show when={!context() && messages().length > 0}>
                <span class="text-11-regular text-text-weak">{messages().length} msgs</span>
              </Show>
              <button
                classList={{
                  "h-6 px-2 flex items-center gap-1 rounded-md text-11-medium border transition-colors": true,
                  "text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30": selectedAgent()?.state === "working",
                  "text-text-weak hover:text-text-strong hover:bg-surface-base-hover border-border-weak-base": selectedAgent()?.state !== "working",
                }}
                onClick={() => {
                  const sid = agentSessionID()
                  if (sid) sdk.client.session.abort({ sessionID: sid }).catch(() => {})
                }}
                aria-label="Stop agent"
              >
                <Icon name="close" class="size-3" />
                Stop
              </button>
              <button
                class="size-6 flex items-center justify-center rounded-md text-text-weak hover:text-text-strong hover:bg-surface-base-hover transition-colors"
                onClick={() => canvas.deselect()}
                aria-label="Close agent chat"
              >
                <Icon name="close" class="size-3.5" />
              </button>
            </div>
          </div>

          {/* Collapsible todo list — between header and messages */}
          <AgentTodoPanel sessionID={agentSessionID()!} agentColor={agentDef()?.color} />

          {/* Messages scroll area */}
          <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <Show
              when={messages().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-8 text-center">
                  <div class="text-12-regular text-text-weak">No messages yet</div>
                  <div class="text-11-regular text-text-weak mt-1">
                    Type below to start a conversation with this agent
                  </div>
                </div>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={messages()}>
                  {(msg) => <ChatBubble message={msg} parts={partsFor(msg.id)} agentColor={agentDef()?.color} />}
                </For>

                {/* EOT indicator — shown when agent completed a task (idle + has messages + has parent) */}
                <Show when={selectedAgent()?.state === "idle" && messages().length > 0 && selectedAgent()?.parentInstanceID}>
                  <div class="flex items-center gap-2 px-3 py-2 mt-2 rounded-md border border-green-500/30 bg-green-500/5">
                    <span class="text-green-500 text-12-medium">{"\u2714"} Task Complete</span>
                    <span class="text-11-regular text-text-weak">{"\u2014"} Result returned to orchestrator</span>
                  </div>
                </Show>

                {/* Working indicator */}
                <Show when={selectedAgent()?.state === "working"}>
                  <div class="flex items-center gap-2 px-3 py-2 mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/5">
                    <span class="text-yellow-500 text-12-medium animate-pulse">{"\u26A1"} Working...</span>
                  </div>
                </Show>

                {/* Agent question — displayed when the child agent asks a question */}
                <Show when={agentQuestion()} keyed>
                  {(req) => (
                    <div class="mt-2" data-component="tool-part-wrapper" data-question="true">
                      <BasicTool
                        icon="bubble-5"
                        locked
                        defaultOpen
                        trigger={{
                          title: `${agentDef()?.name ?? "Agent"} has a question`,
                          subtitle: `${req.questions.length} question${req.questions.length > 1 ? "s" : ""}`,
                        }}
                      />
                      <QuestionDock request={req} />
                    </div>
                  )}
                </Show>

                {/* Agent permission request — displayed when child agent needs permission */}
                <Show when={agentPermission()} keyed>
                  {(perm) => (
                    <div class="mt-2" data-component="tool-part-wrapper" data-permission="true">
                      <BasicTool
                        icon="checklist"
                        locked
                        defaultOpen
                        trigger={{
                          title: `${agentDef()?.name ?? "Agent"} needs permission`,
                          subtitle: perm.permission,
                        }}
                      >
                        <Show when={perm.patterns.length > 0}>
                          <div class="flex flex-col gap-1 py-2 px-3 max-h-40 overflow-y-auto no-scrollbar">
                            <For each={perm.patterns}>
                              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                            </For>
                          </div>
                        </Show>
                      </BasicTool>
                      <div data-component="permission-prompt">
                        <div data-slot="permission-actions">
                          <Button
                            variant="ghost"
                            size="small"
                            onClick={() => props.onDecide("reject")}
                            disabled={props.responding}
                          >
                            Deny
                          </Button>
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => props.onDecide("always")}
                            disabled={props.responding}
                          >
                            Always
                          </Button>
                          <Button
                            variant="primary"
                            size="small"
                            onClick={() => props.onDecide("once")}
                            disabled={props.responding}
                          >
                            Allow
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>

                <div ref={(el) => (scrollAnchor = el)} />
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Prompt input area — visible only when an agent is selected */}
      <Show when={selectedAgent()}>
      <div class="pb-4 pt-3 bg-gradient-to-t from-background-stronger via-background-stronger to-transparent pointer-events-none">
        <div
          classList={{
            "w-full px-4 pointer-events-auto": true,
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
          }}
        >
          {/* Inline spawn picker */}
          <Show when={pickerMode() === "spawn" && spawnOptions().length > 0}>
            <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
              <BasicTool
                icon="bubble-5"
                locked
                defaultOpen
                trigger={{
                  title: "Spawn Agent",
                  subtitle: "Select an agent type",
                }}
              />
              <AgentPicker
                question="Which agent would you like to spawn?"
                options={spawnOptions()}
                onSelect={handleSpawnSelect}
                onDismiss={() => setPickerMode(null)}
              />
            </div>
          </Show>

          {/* Inline task assigner (two-step: pick agent → type task → confirm) */}
          <Show when={pickerMode() === "task" && taskOptions().length > 0}>
            <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
              <BasicTool
                icon="bubble-5"
                locked
                defaultOpen
                trigger={{
                  title: "Assign Task",
                  subtitle: "Select agent and describe task",
                }}
              />
              <TaskAssigner
                options={taskOptions()}
                onSubmit={handleTaskAssign}
                onDismiss={() => setPickerMode(null)}
              />
            </div>
          </Show>

          {/* Show message when /spawn has no parent or /task has no children */}
          <Show when={pickerMode() === "spawn" && spawnOptions().length === 0}>
            <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
              <div data-component="question-prompt">
                <div data-slot="question-content">
                  <div data-slot="question-text">No parent agent found on canvas. Add an orchestrator first.</div>
                </div>
                <div data-slot="question-actions">
                  <Button variant="ghost" size="small" onClick={() => setPickerMode(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </Show>

          <Show when={pickerMode() === "task" && taskOptions().length === 0}>
            <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
              <div data-component="question-prompt">
                <div data-slot="question-content">
                  <div data-slot="question-text">No child agents to assign tasks to. Use /spawn to create one first.</div>
                </div>
                <div data-slot="question-actions">
                  <Button variant="ghost" size="small" onClick={() => setPickerMode(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </Show>

          <Show when={props.questionRequest()} keyed>
            {(req) => {
              const subtitle = questionSubtitle(req.questions.length, (key) => props.t(key))
              return (
                <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
                  <BasicTool
                    icon="bubble-5"
                    locked
                    defaultOpen
                    trigger={{
                      title: props.t("ui.tool.questions"),
                      subtitle,
                    }}
                  />
                  <QuestionDock request={req} />
                </div>
              )
            }}
          </Show>

          <Show when={props.permissionRequest()} keyed>
            {(perm) => (
              <div data-component="tool-part-wrapper" data-permission="true" class="mb-3">
                <BasicTool
                  icon="checklist"
                  locked
                  defaultOpen
                  trigger={{
                    title: props.t("notification.permission.title"),
                    subtitle:
                      perm.permission === "doom_loop"
                        ? props.t("settings.permissions.tool.doom_loop.title")
                        : perm.permission,
                  }}
                >
                  <Show when={perm.patterns.length > 0}>
                    <div class="flex flex-col gap-1 py-2 px-3 max-h-40 overflow-y-auto no-scrollbar">
                      <For each={perm.patterns}>
                        {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                      </For>
                    </div>
                  </Show>
                  <Show when={perm.permission === "doom_loop"}>
                    <div class="text-12-regular text-text-weak pb-2 px-3">
                      {props.t("settings.permissions.tool.doom_loop.description")}
                    </div>
                  </Show>
                </BasicTool>
                <div data-component="permission-prompt">
                  <div data-slot="permission-actions">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => props.onDecide("reject")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.deny")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => props.onDecide("always")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.allowAlways")}
                    </Button>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => props.onDecide("once")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.allowOnce")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={!props.blocked}>
            <Show
              when={props.promptReady}
              fallback={
                <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                  {props.handoffPrompt || props.t("prompt.loading")}
                </div>
              }
            >
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.newSessionWorktree}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onSubmit={props.onSubmit}
                agentSessionID={agentSessionID}
                agentModelLabel={() => agentDef()?.model}
                agentOverride={() => {
                  const def = agentDef()
                  if (!def?.model) return undefined
                  return { agentName: def.id, model: def.model }
                }}
              />
            </Show>
          </Show>
        </div>
      </div>
      </Show>
    </div>
  )
}
