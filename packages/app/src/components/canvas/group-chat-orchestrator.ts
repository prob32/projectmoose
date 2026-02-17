/**
 * Group Chat Orchestrator — Round-Robin Multi-Agent Conversation
 *
 * Orchestrates a group chat where each selected agent takes turns responding
 * to a shared conversation. Each agent sees the full conversation history
 * including all prior agents' responses.
 *
 * The round-robin is driven entirely from the frontend — no backend changes needed.
 * We reuse the existing `client.session.promptAsync()` API with different `agent`
 * parameters per turn, all pointed at the same shared session.
 */

import { createRoot, createEffect } from "solid-js"
import type { AgentInstanceInfo, AgentDefinitionInfo } from "@/context/canvas"

export type GroupChatOrchestatorDeps = {
  /** SDK client for session API calls */
  client: {
    session: {
      promptAsync: (options: any) => Promise<any>
      abort: (options: any) => Promise<any>
      create: (options: any) => Promise<any>
    }
  }
  /** Reactive sync store for watching session status */
  syncData: {
    session_status: { [sessionID: string]: { type: string } | undefined }
  }
  /** Canvas store accessors */
  canvas: {
    instances: AgentInstanceInfo[]
    groupChat: {
      memberInstanceIDs: string[]
      sessionID: string
      status: "idle" | "running"
      currentAgentIndex: number
    } | undefined
    definitionFor: (inst: AgentInstanceInfo) => AgentDefinitionInfo | undefined
    setGroupChatStatus: (status: "idle" | "running", index?: number) => void
  }
}

let abortController: AbortController | null = null

/**
 * Wait for a session to become idle by watching the reactive sync store.
 * Uses `createRoot` + `createEffect` to bridge SolidJS reactivity → Promise.
 */
function waitForSessionIdle(
  sessionID: string,
  syncData: GroupChatOrchestatorDeps["syncData"],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check abort immediately
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })

    createRoot((dispose) => {
      createEffect(() => {
        const status = syncData.session_status[sessionID]
        if (status?.type === "idle") {
          signal.removeEventListener("abort", onAbort)
          queueMicrotask(() => {
            dispose()
            resolve()
          })
        }
      })
    })
  })
}

/**
 * Run a round-robin group conversation. Each agent responds in order,
 * seeing the full conversation history.
 */
export async function startRoundRobin(
  userPrompt: string,
  deps: GroupChatOrchestatorDeps,
): Promise<void> {
  const group = deps.canvas.groupChat
  if (!group) return

  // Create abort controller for this round
  abortController = new AbortController()
  const signal = abortController.signal

  deps.canvas.setGroupChatStatus("running", 0)

  try {
    for (let i = 0; i < group.memberInstanceIDs.length; i++) {
      if (signal.aborted) break

      deps.canvas.setGroupChatStatus("running", i)

      const instance = deps.canvas.instances.find(
        (inst) => inst.id === group.memberInstanceIDs[i],
      )
      if (!instance) continue

      const def = deps.canvas.definitionFor(instance)
      const agentName = def?.id ?? instance.agentDefinitionID
      const model = def?.model

      // First agent gets the raw user prompt.
      // Subsequent agents get a contextual continuation prompt — they already
      // see the full conversation history (all prior messages in the session).
      const promptText =
        i === 0
          ? userPrompt
          : `[You are ${def?.name ?? agentName} in a group discussion. Review the conversation above and contribute your perspective or take action.]`

      await deps.client.session.promptAsync({
        path: { id: group.sessionID },
        body: {
          agent: agentName,
          ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
          parts: [{ type: "text", text: promptText }],
        },
      })

      // Wait for this agent's turn to complete
      await waitForSessionIdle(group.sessionID, deps.syncData, signal)
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      console.error("[GroupChat] Round-robin error:", e)
    }
  } finally {
    deps.canvas.setGroupChatStatus("idle", 0)
    abortController = null
  }
}

/** Abort the currently running round-robin conversation */
export function abortRoundRobin(
  deps: Pick<GroupChatOrchestatorDeps, "client" | "canvas">,
): void {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  const group = deps.canvas.groupChat
  if (group) {
    deps.client.session.abort({ path: { id: group.sessionID } }).catch(() => {})
    deps.canvas.setGroupChatStatus("idle", 0)
  }
}
