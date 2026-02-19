import { Scheduler } from "@/scheduler"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { MooseAgentInstance } from "./instance"
import { MooseAgentDefinition } from "./definition"
import { MooseAgentEvent } from "./events"

export namespace MooseAgentGC {
  const log = Log.create({ service: "moose.agent.gc" })

  /** How often the GC sweep runs (30 seconds) */
  const SWEEP_INTERVAL_MS = 30_000

  /** How many seconds before timeout to start showing warnings */
  const WARNING_THRESHOLD_S = 30

  export function init() {
    // Capture the instance directory at init time — this runs inside Instance.provide()
    // but the setInterval callback will fire outside that context.
    const directory = Instance.directory
    Scheduler.register({
      id: "moose.agent.gc",
      interval: SWEEP_INTERVAL_MS,
      run: async () => {
        await Instance.provide({
          directory,
          fn: sweep,
        })
      },
      scope: "instance",
    })
    log.info("GC registered", { interval: SWEEP_INTERVAL_MS, directory })
  }

  /** Archive the session linked to a Moose instance, then remove the instance */
  async function archiveAndRemove(instance: MooseAgentInstance.Info) {
    // Archive the linked session so it disappears from the sidebar
    if (instance.sessionID) {
      try {
        await Session.setArchived({ sessionID: instance.sessionID, time: Date.now() })
      } catch (e) {
        log.warn("GC failed to archive session", { sessionID: instance.sessionID, error: e })
      }
    }
    try {
      await MooseAgentInstance.remove(instance.id)
    } catch (e) {
      log.error("GC failed to delete instance", { id: instance.id, error: e })
    }
  }

  /** How long an orphaned child session must be idle before being archived (60s) */
  const ORPHAN_AGE_MS = 60_000

  async function sweep() {
    const now = Date.now()
    const allInstances = MooseAgentInstance.listAll()

    // Cache definitions to avoid repeated lookups
    const defCache = new Map<string, MooseAgentDefinition.Info | undefined>()
    async function getDef(id: string) {
      if (defCache.has(id)) return defCache.get(id)
      const def = await MooseAgentDefinition.get(id)
      defCache.set(id, def)
      return def
    }

    for (const instance of allInstances) {
      // Rule: Top-level agents (no parentInstanceID) are NEVER auto-deleted
      if (!instance.parentInstanceID) continue

      // Rule: Agents in "working" state are skipped
      if (instance.state === "working") continue

      const def = await getDef(instance.agentDefinitionID)
      const timeoutSeconds = def?.idle_timeout ?? 120

      // Rule: idle_timeout: 0 means never auto-delete
      if (timeoutSeconds === 0) continue

      const lastActive = instance.timeLastActive ?? instance.time.created
      const elapsedMs = now - lastActive
      const elapsedSeconds = elapsedMs / 1000
      const secondsRemaining = Math.max(0, timeoutSeconds - elapsedSeconds)

      if (secondsRemaining <= 0) {
        // Time's up — cascade delete instance + all children
        log.info("GC deleting idle agent", {
          id: instance.id,
          definition: instance.agentDefinitionID,
          idleSeconds: Math.round(elapsedSeconds),
        })

        // Delete children first (cascade)
        const children = MooseAgentInstance.listByParent(instance.id)
        for (const child of children) {
          await archiveAndRemove(child)
        }

        // Delete the instance itself
        await archiveAndRemove(instance)
      } else if (secondsRemaining <= WARNING_THRESHOLD_S) {
        // Approaching timeout — emit warning event
        Bus.publish(MooseAgentEvent.GCWarning, {
          instanceID: instance.id,
          secondsRemaining: Math.round(secondsRemaining),
        })
      }
    }

    // ── Orphaned child session cleanup ──────────────────────────────────
    // Archive child sessions that have no corresponding Moose instance.
    // These can appear when the task tool creates a session but the instance
    // creation fails, or when sessions were created by an older server version
    // that didn't create canvas instances.
    try {
      // Build set of all session IDs that have a Moose instance
      const instanceSessionIDs = new Set(
        allInstances.filter((i) => i.sessionID).map((i) => i.sessionID!),
      )

      // Check all sessions for orphaned children
      for (const session of Session.list()) {
        // Only look at child sessions (have a parentID)
        if (!session.parentID) continue
        // Already archived — skip
        if (session.time.archived) continue
        // Has a Moose instance — not orphaned
        if (instanceSessionIDs.has(session.id)) continue
        // Don't archive very new sessions — they might still be initializing
        if (now - session.time.updated < ORPHAN_AGE_MS) continue

        log.info("GC archiving orphaned child session", {
          sessionID: session.id,
          title: session.title,
          age: Math.round((now - session.time.updated) / 1000),
        })
        try {
          await Session.setArchived({ sessionID: session.id, time: Date.now() })
        } catch (e) {
          log.warn("GC failed to archive orphaned session", { sessionID: session.id, error: e })
        }
      }
    } catch (e) {
      log.warn("GC orphaned session cleanup failed", { error: e })
    }
  }
}
