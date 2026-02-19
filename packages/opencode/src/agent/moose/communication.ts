import z from "zod"
import { fn } from "@/util/fn"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { MooseAgentInstance } from "./instance"
import { MooseAgentEvent } from "./events"
import { AgentMessageType } from "./schema"

export namespace MooseAgentCommunication {
  const log = Log.create({ service: "moose.communication" })

  /** Message types that a child can send to its parent */
  const CHILD_TO_PARENT_TYPES = ["question", "scope_request", "result"] as const

  /** Message types that a parent can send to its child */
  const PARENT_TO_CHILD_TYPES = ["answer", "result"] as const

  export const MessageType = AgentMessageType
  export type MessageType = AgentMessageType

  /**
   * Send a message between parent and child instances.
   * Validates that:
   * - Both instances exist
   * - They have a direct parent-child relationship
   * - The message type is valid for the direction
   */
  export const send = fn(
    z.object({
      fromInstanceID: z.string(),
      toInstanceID: z.string(),
      type: MessageType,
      content: z.string(),
    }),
    async (input) => {
      // Get both instances
      const from = await MooseAgentInstance.get(input.fromInstanceID)
      const to = await MooseAgentInstance.get(input.toInstanceID)

      // Validate direct parent-child relationship
      const fromIsChild = from.parentInstanceID === to.id
      const toIsChild = to.parentInstanceID === from.id

      if (!fromIsChild && !toIsChild) {
        throw new Error(
          `Instances "${input.fromInstanceID}" and "${input.toInstanceID}" are not directly related (must be parent-child)`,
        )
      }

      // Validate direction-appropriate message type
      if (fromIsChild) {
        // Child → Parent: only question, scope_request, result
        if (!(CHILD_TO_PARENT_TYPES as readonly string[]).includes(input.type)) {
          throw new Error(
            `Child cannot send "${input.type}" to parent. Allowed: ${CHILD_TO_PARENT_TYPES.join(", ")}`,
          )
        }
      } else {
        // Parent → Child: only answer, result
        if (!(PARENT_TO_CHILD_TYPES as readonly string[]).includes(input.type)) {
          throw new Error(
            `Parent cannot send "${input.type}" to child. Allowed: ${PARENT_TO_CHILD_TYPES.join(", ")}`,
          )
        }
      }

      // Publish the message event
      await Bus.publish(MooseAgentEvent.Message, {
        fromInstanceID: input.fromInstanceID,
        toInstanceID: input.toInstanceID,
        type: input.type,
        content: input.content,
      })

      // Touch both instances to reset idle timers
      await MooseAgentInstance.touch(input.fromInstanceID)
      await MooseAgentInstance.touch(input.toInstanceID)

      log.info("message sent", {
        from: input.fromInstanceID,
        to: input.toInstanceID,
        type: input.type,
        direction: fromIsChild ? "child→parent" : "parent→child",
      })
    },
  )

  /**
   * Escalate a question from an agent.
   * - If the agent has a parent: sends a scope_request to the parent
   * - If top-level (no parent): sets agent state to "question" for user to answer
   */
  export const escalate = fn(
    z.object({
      instanceID: z.string(),
      content: z.string(),
    }),
    async (input) => {
      const instance = await MooseAgentInstance.get(input.instanceID)

      if (instance.parentInstanceID) {
        // Has parent — escalate via message
        await send({
          fromInstanceID: input.instanceID,
          toInstanceID: instance.parentInstanceID,
          type: "scope_request",
          content: input.content,
        })
      } else {
        // Top-level — set state to "question" for user input
        await MooseAgentInstance.setState({
          instanceID: input.instanceID,
          state: "question",
          errorMessage: input.content,
        })
      }

      log.info("escalated", {
        instanceID: input.instanceID,
        hasParent: !!instance.parentInstanceID,
      })
    },
  )
}
