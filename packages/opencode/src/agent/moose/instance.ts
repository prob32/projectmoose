import z from "zod"
import { Bus } from "@/bus"
import { Database, eq, NotFoundError } from "@/storage/db"
import { AgentInstanceTable } from "./instance.sql"
import { Identifier } from "@/id/id"
import { Log } from "../../util/log"
import { fn } from "@/util/fn"
import { MooseAgentEvent } from "./events"
import { MooseAgentDefinition } from "./definition"
import { Session } from "../../session"
import { AgentInstanceState, AgentInstanceInfo } from "./schema"
import { repelOverlaps as repelOverlapsCore, redistributeSiblings } from "./layout"
import { isSpawnAllowed, checkSpawnLimit, calculateChildPosition } from "./spawn"

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

  // Re-export schemas under original names for backward compatibility
  export const State = AgentInstanceState
  export type State = AgentInstanceState
  export const Info = AgentInstanceInfo
  export type Info = AgentInstanceInfo

  type InstanceRow = typeof AgentInstanceTable.$inferSelect

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
   * Delegates to layout.ts via callback injection.
   */
  export async function repelOverlaps(workspaceSessionID: string) {
    await repelOverlapsCore(workspaceSessionID, listByWorkspace, async (inp) => { await move(inp) })
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
      if (!isSpawnAllowed(parentDef, input.childDefinitionID)) {
        throw new Error(
          `Agent "${parentDef.id}" cannot spawn "${input.childDefinitionID}". Allowed: ${parentDef.spawnable?.agents?.join(", ") ?? "none"}`,
        )
      }

      // 4. Check spawn limit
      const existingChildren = listByParent(input.parentInstanceID)
      checkSpawnLimit(parentDef, existingChildren.length)

      // 5. Calculate temporary child position (will be redistributed after creation)
      const pos = calculateChildPosition(parent.positionX, parent.positionY, input.positionX, input.positionY)

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
        positionX: pos.x,
        positionY: pos.y,
      })

      // 10. Redistribute ALL siblings evenly around the parent to prevent overlap
      if (!input.positionX && !input.positionY) {
        await redistributeSiblings(
          input.parentInstanceID, parent.positionX, parent.positionY,
          listByParent, async (inp) => { await move(inp) },
        )
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
