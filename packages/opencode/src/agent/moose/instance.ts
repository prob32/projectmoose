import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq, NotFoundError } from "@/storage/db"
import { AgentInstanceTable } from "./instance.sql"
import { Identifier } from "@/id/id"
import { Log } from "../../util/log"
import { fn } from "@/util/fn"
import { MooseAgentEvent } from "./events"
import { MooseAgentDefinition } from "./definition"
import { Session } from "../../session"

/** Library of common English names for randomly naming agent instances */
const AGENT_NAMES = [
  "Alice", "Bob", "Charlie", "Diana", "Ethan", "Fiona", "George", "Hannah",
  "Isaac", "Julia", "Kevin", "Luna", "Mason", "Nora", "Oscar", "Penny",
  "Quinn", "Ruby", "Sam", "Tara", "Uriel", "Vera", "Wade", "Xena",
  "Yuri", "Zoe", "Archer", "Bella", "Cody", "Daisy", "Eli", "Grace",
  "Hugo", "Ivy", "Jake", "Kate", "Leo", "Mia", "Noah", "Olive",
  "Piper", "Rex", "Sage", "Tess", "Vince", "Wren", "Axel", "Cleo",
  "Dex", "Elsa", "Finn", "Gwen", "Hank", "Iris", "Juno", "Knox",
  "Lily", "Max", "Nell", "Otto", "Pearl", "Reed", "Scout", "Troy",
]

export namespace MooseAgentInstance {
  const log = Log.create({ service: "moose.instance" })

  export const State = z.enum(["idle", "working", "error", "question", "spawning"])
  export type State = z.infer<typeof State>

  type InstanceRow = typeof AgentInstanceTable.$inferSelect

  export const Info = z
    .object({
      id: Identifier.schema("agent_instance"),
      workspaceSessionID: z.string(),
      agentDefinitionID: z.string(),
      sessionID: z.string().optional(),
      parentInstanceID: z.string().optional(),
      positionX: z.number(),
      positionY: z.number(),
      state: State,
      errorMessage: z.string().optional(),
      displayName: z.string().optional(),
      timeLastActive: z.number().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "MooseAgentInstance",
    })
  export type Info = z.infer<typeof Info>

  export function fromRow(row: InstanceRow): Info {
    return {
      id: row.id,
      workspaceSessionID: row.workspace_session_id,
      agentDefinitionID: row.agent_definition_id,
      sessionID: row.session_id ?? undefined,
      parentInstanceID: row.parent_instance_id ?? undefined,
      positionX: row.position_x,
      positionY: row.position_y,
      state: row.state as State,
      errorMessage: row.error_message ?? undefined,
      displayName: row.display_name ?? undefined,
      timeLastActive: row.time_last_active ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      workspace_session_id: info.workspaceSessionID,
      agent_definition_id: info.agentDefinitionID,
      session_id: info.sessionID ?? null,
      parent_instance_id: info.parentInstanceID ?? null,
      position_x: info.positionX,
      position_y: info.positionY,
      state: info.state,
      error_message: info.errorMessage ?? null,
      display_name: info.displayName ?? null,
      time_last_active: info.timeLastActive ?? null,
      time_created: info.time.created,
      time_updated: info.time.updated,
    }
  }

  /** Pick a random name not already used by any sibling in the same workspace */
  function pickUniqueName(workspaceSessionID: string): string {
    const existing = listByWorkspace(workspaceSessionID)
    const usedNames = new Set(existing.map((i) => i.displayName).filter(Boolean))
    const available = AGENT_NAMES.filter((n) => !usedNames.has(n))
    if (available.length === 0) {
      // Exhausted the list — add a numeric suffix
      return AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)]! + `-${existing.length}`
    }
    return available[Math.floor(Math.random() * available.length)]!
  }

  export const create = fn(
    z.object({
      workspaceSessionID: z.string(),
      agentDefinitionID: z.string(),
      sessionID: z.string().optional(),
      parentInstanceID: z.string().optional(),
      displayName: z.string().optional(),
      positionX: z.number().default(0),
      positionY: z.number().default(0),
    }),
    async (input) => {
      const now = Date.now()
      // Auto-assign a unique random name if none provided
      const name = input.displayName ?? pickUniqueName(input.workspaceSessionID)
      const instance: Info = {
        id: Identifier.ascending("agent_instance"),
        workspaceSessionID: input.workspaceSessionID,
        agentDefinitionID: input.agentDefinitionID,
        sessionID: input.sessionID,
        parentInstanceID: input.parentInstanceID,
        displayName: name,
        positionX: input.positionX,
        positionY: input.positionY,
        state: "idle",
        timeLastActive: now,
        time: {
          created: now,
          updated: now,
        },
      }

      Database.use((db) => {
        db.insert(AgentInstanceTable).values(toRow(instance)).run()
        Database.effect(() =>
          Bus.publish(MooseAgentEvent.Spawned, {
            instance,
            parentInstanceID: input.parentInstanceID,
          }),
        )
      })

      log.info("created agent instance", { id: instance.id, definition: input.agentDefinitionID })
      return instance
    },
  )

  export const get = fn(Identifier.schema("agent_instance"), async (id) => {
    const row = Database.use((db) => db.select().from(AgentInstanceTable).where(eq(AgentInstanceTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Agent instance not found: ${id}` })
    return fromRow(row)
  })

  export function listByWorkspace(workspaceSessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AgentInstanceTable)
        .where(eq(AgentInstanceTable.workspace_session_id, workspaceSessionID))
        .all(),
    )
    return rows.map(fromRow)
  }

  export const move = fn(
    z.object({
      instanceID: Identifier.schema("agent_instance"),
      x: z.number(),
      y: z.number(),
    }),
    async (input) => {
      const now = Date.now()
      Database.use((db) => {
        const row = db
          .update(AgentInstanceTable)
          .set({
            position_x: input.x,
            position_y: input.y,
            time_updated: now,
          })
          .where(eq(AgentInstanceTable.id, input.instanceID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Agent instance not found: ${input.instanceID}` })
        Database.effect(() =>
          Bus.publish(MooseAgentEvent.Moved, {
            instanceID: input.instanceID,
            x: input.x,
            y: input.y,
          }),
        )
      })
    },
  )

  export const setState = fn(
    z.object({
      instanceID: Identifier.schema("agent_instance"),
      state: State,
      errorMessage: z.string().optional(),
    }),
    async (input) => {
      const now = Date.now()
      Database.use((db) => {
        const row = db
          .update(AgentInstanceTable)
          .set({
            state: input.state,
            error_message: input.errorMessage ?? null,
            time_last_active: now,
            time_updated: now,
          })
          .where(eq(AgentInstanceTable.id, input.instanceID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Agent instance not found: ${input.instanceID}` })
        Database.effect(() =>
          Bus.publish(MooseAgentEvent.StateChanged, {
            instanceID: input.instanceID,
            state: input.state,
            error: input.errorMessage,
            timeLastActive: now,
          }),
        )
      })
    },
  )

  export const setSession = fn(
    z.object({
      instanceID: Identifier.schema("agent_instance"),
      sessionID: z.string(),
    }),
    async (input) => {
      Database.use((db) => {
        const row = db
          .update(AgentInstanceTable)
          .set({
            session_id: input.sessionID,
            time_updated: Date.now(),
          })
          .where(eq(AgentInstanceTable.id, input.instanceID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Agent instance not found: ${input.instanceID}` })
      })
    },
  )

  export const remove = fn(Identifier.schema("agent_instance"), async (instanceID) => {
    const instance = await get(instanceID)
    Database.use((db) => {
      db.delete(AgentInstanceTable).where(eq(AgentInstanceTable.id, instanceID)).run()
      Database.effect(() =>
        Bus.publish(MooseAgentEvent.Deleted, {
          instanceID,
          workspaceSessionID: instance.workspaceSessionID,
        }),
      )
    })
    log.info("removed agent instance", { id: instanceID })
  })

  export const touch = fn(Identifier.schema("agent_instance"), async (instanceID) => {
    const now = Date.now()
    Database.use((db) => {
      db.update(AgentInstanceTable)
        .set({ time_last_active: now, time_updated: now })
        .where(eq(AgentInstanceTable.id, instanceID))
        .run()
    })
  })

  /** List all children of a parent instance */
  export function listByParent(parentInstanceID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AgentInstanceTable)
        .where(eq(AgentInstanceTable.parent_instance_id, parentInstanceID))
        .all(),
    )
    return rows.map(fromRow)
  }

  /** List all instances across all workspaces (for GC) */
  export function listAll(): Info[] {
    const rows = Database.use((db) => db.select().from(AgentInstanceTable).all())
    return rows.map(fromRow)
  }

  /** Find an instance by its linked session ID */
  export function findBySessionID(sessionID: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(AgentInstanceTable)
        .where(eq(AgentInstanceTable.session_id, sessionID))
        .get(),
    )
    return row ? fromRow(row) : undefined
  }

  /**
   * Run a simple force-directed repulsion pass to push overlapping nodes apart.
   * Iterates a few times to resolve clusters. Only moves nodes that overlap
   * within a minimum distance threshold.
   */
  export async function repelOverlaps(workspaceSessionID: string) {
    const MIN_DISTANCE = 100 // nodes closer than this get pushed apart
    const ITERATIONS = 3

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const all = listByWorkspace(workspaceSessionID)
      if (all.length < 2) return

      const moves: Array<{ id: string; x: number; y: number }> = []

      for (let i = 0; i < all.length; i++) {
        let fx = 0
        let fy = 0
        for (let j = 0; j < all.length; j++) {
          if (i === j) continue
          const dx = all[i].positionX - all[j].positionX
          const dy = all[i].positionY - all[j].positionY
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MIN_DISTANCE && dist > 0) {
            // Push apart proportionally to overlap
            const force = (MIN_DISTANCE - dist) / 2
            fx += (dx / dist) * force
            fy += (dy / dist) * force
          } else if (dist === 0) {
            // Identical positions: push in a random-ish direction based on index
            const angle = (i * 2.39996) % (Math.PI * 2) // golden angle
            fx += Math.cos(angle) * (MIN_DISTANCE / 2)
            fy += Math.sin(angle) * (MIN_DISTANCE / 2)
          }
        }

        if (Math.abs(fx) > 1 || Math.abs(fy) > 1) {
          moves.push({
            id: all[i].id,
            x: Math.round(all[i].positionX + fx),
            y: Math.round(all[i].positionY + fy),
          })
        }
      }

      if (moves.length === 0) break // no overlaps, done

      for (const m of moves) {
        await move({ instanceID: m.id, x: m.x, y: m.y })
      }
    }
  }

  /** Spawn a validated child agent instance from a parent */
  export const spawn = fn(
    z.object({
      parentInstanceID: z.string(),
      childDefinitionID: z.string(),
      workspaceSessionID: z.string(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
    }),
    async (input) => {
      // 1. Get parent instance
      const parent = await get(input.parentInstanceID)

      // 2. Get parent definition to check spawnable config
      const parentDef = await MooseAgentDefinition.get(parent.agentDefinitionID)
      if (!parentDef) {
        throw new Error(`Parent definition not found: ${parent.agentDefinitionID}`)
      }

      // 3. Validate child is in spawnable list
      if (!parentDef.spawnable?.agents?.includes(input.childDefinitionID)) {
        throw new Error(
          `Agent "${parentDef.id}" cannot spawn "${input.childDefinitionID}". Allowed: ${parentDef.spawnable?.agents?.join(", ") ?? "none"}`,
        )
      }

      // 4. Check spawn limit
      const existingChildren = listByParent(input.parentInstanceID)
      const limit = parentDef.spawnable.limit
      if (typeof limit === "number" && existingChildren.length >= limit) {
        throw new Error(`Spawn limit reached: ${existingChildren.length}/${limit} children`)
      }
      if (limit === "auto" && existingChildren.length >= 20) {
        throw new Error(`Auto spawn limit reached: maximum 20 children`)
      }

      // 5. Calculate temporary child position (will be redistributed after creation)
      const distance = 160
      const childX = input.positionX ?? Math.round(parent.positionX)
      const childY = input.positionY ?? Math.round(parent.positionY + distance)

      // 6. Get child definition for session title
      const childDef = await MooseAgentDefinition.get(input.childDefinitionID)
      const title = childDef
        ? `Agent: ${childDef.name} (child of ${parentDef.name})`
        : `Agent: ${input.childDefinitionID}`

      // 7. Create session for child, linked to parent session
      const session = await Session.create({
        parentID: parent.sessionID,
        title,
      })

      // 8. Set parent state to "spawning" briefly
      await setState({ instanceID: input.parentInstanceID, state: "spawning" })

      // 9. Create child instance
      const child = await create({
        workspaceSessionID: input.workspaceSessionID,
        agentDefinitionID: input.childDefinitionID,
        sessionID: session.id,
        parentInstanceID: input.parentInstanceID,
        positionX: childX,
        positionY: childY,
      })

      // 10. Redistribute ALL siblings evenly around the parent to prevent overlap
      if (!input.positionX && !input.positionY) {
        const allSiblings = listByParent(input.parentInstanceID)
        const total = allSiblings.length
        const maxSlots = 12
        const spreadAngle = Math.PI * 0.8 // 144° arc below parent
        const startAngle = Math.PI / 2 - spreadAngle / 2
        for (let i = 0; i < total; i++) {
          const step = total <= 1 ? 0 : spreadAngle / (Math.min(maxSlots, total) - 1)
          const angle = total === 1 ? Math.PI / 2 : startAngle + i * step
          const newX = Math.round(parent.positionX + Math.cos(angle) * distance)
          const newY = Math.round(parent.positionY + Math.sin(angle) * distance)
          await move({ instanceID: allSiblings[i].id, x: newX, y: newY })
        }
      }

      // 11. Run repulsion pass to push apart any overlapping nodes across the whole canvas
      await repelOverlaps(input.workspaceSessionID)

      // 12. Reset parent to idle after spawn
      await setState({ instanceID: input.parentInstanceID, state: "idle" })

      log.info("spawned child agent", {
        parentID: input.parentInstanceID,
        childID: child.id,
        childDef: input.childDefinitionID,
      })

      return child
    },
  )
}
