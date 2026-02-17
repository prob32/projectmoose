import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace MooseAgentEvent {
  /** Inline schema to avoid circular dependency with instance.ts */
  const InstanceInfo = z.object({
    id: z.string(),
    workspaceSessionID: z.string(),
    agentDefinitionID: z.string(),
    sessionID: z.string().optional(),
    parentInstanceID: z.string().optional(),
    positionX: z.number(),
    positionY: z.number(),
    state: z.enum(["idle", "working", "error", "question", "spawning"]),
    errorMessage: z.string().optional(),
    displayName: z.string().optional(),
    timeLastActive: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })

  export const Spawned = BusEvent.define(
    "moose.agent.spawned",
    z.object({
      instance: InstanceInfo,
      parentInstanceID: z.string().optional(),
    }),
  )

  export const StateChanged = BusEvent.define(
    "moose.agent.state_changed",
    z.object({
      instanceID: z.string(),
      state: z.enum(["idle", "working", "error", "question", "spawning"]),
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
      type: z.enum(["question", "scope_request", "answer", "result"]),
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
