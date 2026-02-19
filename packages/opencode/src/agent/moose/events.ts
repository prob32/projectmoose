import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { AgentInstanceInfo, AgentInstanceState, AgentMessageType } from "./schema"

export namespace MooseAgentEvent {
  export const Spawned = BusEvent.define(
    "moose.agent.spawned",
    z.object({
      instance: AgentInstanceInfo,
      parentInstanceID: z.string().optional(),
    }),
  )

  export const StateChanged = BusEvent.define(
    "moose.agent.state_changed",
    z.object({
      instanceID: z.string(),
      state: AgentInstanceState,
      error: z.string().optional(),
      timeLastActive: z.number().optional(),
    }),
  )

  export const Deleted = BusEvent.define(
    "moose.agent.deleted",
    z.object({
      instanceID: z.string(),
      workspaceSessionID: z.string(),
    }),
  )

  export const Moved = BusEvent.define(
    "moose.agent.moved",
    z.object({
      instanceID: z.string(),
      x: z.number(),
      y: z.number(),
    }),
  )

  export const Message = BusEvent.define(
    "moose.agent.message",
    z.object({
      fromInstanceID: z.string(),
      toInstanceID: z.string(),
      type: AgentMessageType,
      content: z.string(),
    }),
  )

  export const GCWarning = BusEvent.define(
    "moose.agent.gc_warning",
    z.object({
      instanceID: z.string(),
      secondsRemaining: z.number(),
    }),
  )
}
