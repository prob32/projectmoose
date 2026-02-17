import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { MooseAgentInstance } from "../agent/moose/instance"
import { MooseAgentDefinition } from "../agent/moose/definition"
import { Todo } from "../session/todo"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.task" })

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  let accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  // NOTE: We intentionally do NOT filter the tool description by Moose spawnable
  // config here. The description is built once at session init and cached — if the
  // user updates spawnable config mid-session, the stale description would block
  // agents even though they're now allowed. Instead, we show all permission-allowed
  // agents in the description and rely on the runtime enforcement inside execute()
  // to hard-block unauthorized spawns. This means the LLM may attempt to spawn an
  // agent outside the spawnable list, but the runtime check will reject it with a
  // clear error, and the LLM will retry with a valid agent.

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      log.info("task.execute START", {
        subagent: params.subagent_type,
        description: params.description,
        caller: ctx.agent,
        sessionID: ctx.sessionID,
        resuming: !!params.task_id,
      })
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Runtime enforcement: determine the ACTUAL calling agent using two methods:
      // 1. MooseAgentInstance.findBySessionID(ctx.sessionID) — most reliable, maps
      //    the session directly to a Moose instance with a known agentDefinitionID
      // 2. ctx.agent (string) — fallback, set by prompt.ts context factory at runtime
      // The definition is read fresh from disk each time so config changes take
      // effect immediately without restarting the session.
      {
        let callerDefID: string | undefined

        // Method 1: look up Moose instance by session ID (most reliable)
        const callerInstance = MooseAgentInstance.findBySessionID(ctx.sessionID)
        if (callerInstance) {
          callerDefID = callerInstance.agentDefinitionID
        }

        // Method 2: fall back to ctx.agent (the runtime agent name string)
        if (!callerDefID) {
          callerDefID = ctx.agent
        }

        log.info("spawnable check", { callerDefID, target: params.subagent_type })

        try {
          const callerDef = await MooseAgentDefinition.get(callerDefID)
          if (callerDef?.spawnable?.agents?.length) {
            const allowed = new Set(callerDef.spawnable.agents)
            if (!allowed.has(params.subagent_type)) {
              log.warn("BLOCKED — spawnable denied", {
                caller: callerDef.id,
                target: params.subagent_type,
                allowed: callerDef.spawnable.agents,
              })
              throw new Error(
                `Agent "${callerDef.name}" (${callerDef.id}) is not allowed to delegate to "${params.subagent_type}". Allowed agents: ${callerDef.spawnable.agents.join(", ")}`,
              )
            }
            log.info("spawnable ALLOWED", { caller: callerDef.id, target: params.subagent_type })
          } else {
            log.info("spawnable check SKIPPED — no spawnable config or not a Moose agent", { callerDefID })
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("is not allowed to delegate")) {
            throw e
          }
          // Non-fatal for non-Moose agents (callerDef won't be found)
        }
      }

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      // Check if the child agent is an orchestrator (has spawnable config).
      // Orchestrators need todowrite/todoread to manage their own task lists.
      let childIsOrchestrator = false

      // Bridge: if the subagent is a Moose agent, try to reuse an existing idle
      // canvas instance instead of creating a duplicate "invisible" one.
      // When users pre-spawn agents on the canvas, those instances should be
      // picked up by the orchestrator's task tool rather than spawning new ones.
      let mooseChildInstance: MooseAgentInstance.Info | undefined
      let reuseExistingSession = false
      try {
        const mooseDef = await MooseAgentDefinition.get(params.subagent_type)
        if (mooseDef) {
          childIsOrchestrator = !!(mooseDef.spawnable?.agents?.length)
          const parentMooseInstance = MooseAgentInstance.findBySessionID(ctx.sessionID)
          if (parentMooseInstance) {
            // Look for an existing idle child of the same type under this parent
            const existingChildren = MooseAgentInstance.listByParent(parentMooseInstance.id)
            const idleChild = existingChildren.find(
              (c) => c.agentDefinitionID === params.subagent_type && c.state === "idle" && c.sessionID,
            )
            if (idleChild) {
              mooseChildInstance = idleChild
              reuseExistingSession = true
              log.info("reusing idle child instance", { childID: idleChild.id, sessionID: idleChild.sessionID })
            }
          }
        }
      } catch {
        // Non-fatal: canvas visualization is optional
      }

      const session = await iife(async () => {
        // If resuming a previous task, reuse that session
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) return found
        }

        // If reusing an existing Moose child instance, use its pre-created session
        // so that chat messages appear on the correct canvas agent
        if (reuseExistingSession && mooseChildInstance?.sessionID) {
          const found = await Session.get(mooseChildInstance.sessionID).catch(() => {})
          if (found) return found
        }

        // Orchestrator children (e.g., Junior Moose) need todowrite/todoread to
        // manage their own task lists. Leaf agents keep them denied.
        const todoPermissions = childIsOrchestrator
          ? [
              { permission: "todowrite" as const, pattern: "*" as const, action: "allow" as const },
              { permission: "todoread" as const, pattern: "*" as const, action: "allow" as const },
            ]
          : [
              { permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const },
              { permission: "todoread" as const, pattern: "*" as const, action: "deny" as const },
            ]

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            ...todoPermissions,
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })

      // If we didn't find an existing instance above, create a new canvas instance
      try {
        if (!mooseChildInstance) {
          const mooseDef = await MooseAgentDefinition.get(params.subagent_type)
          if (mooseDef) {
            const parentMooseInstance = MooseAgentInstance.findBySessionID(ctx.sessionID)
            if (parentMooseInstance) {
              // Create the instance with a temporary position (will be redistributed below)
              const tempX = parentMooseInstance.positionX
              const tempY = parentMooseInstance.positionY + 160

              mooseChildInstance = await MooseAgentInstance.create({
                workspaceSessionID: parentMooseInstance.workspaceSessionID,
                agentDefinitionID: params.subagent_type,
                sessionID: session.id,
                parentInstanceID: parentMooseInstance.id,
                positionX: tempX,
                positionY: tempY,
              })

              // Redistribute ALL siblings evenly around the parent to prevent overlap
              // This handles concurrent spawns: each spawn redistributes everyone
              const allSiblings = MooseAgentInstance.listByParent(parentMooseInstance.id)
              const total = allSiblings.length
              const maxSlots = 12
              const spreadAngle = Math.PI * 0.8 // 144° arc below parent
              const startAngle = Math.PI / 2 - spreadAngle / 2
              const distance = 160

              for (let i = 0; i < total; i++) {
                const step = total <= 1 ? 0 : spreadAngle / (Math.min(maxSlots, total) - 1)
                const angle = total === 1 ? Math.PI / 2 : startAngle + i * step
                const newX = Math.round(parentMooseInstance.positionX + Math.cos(angle) * distance)
                const newY = Math.round(parentMooseInstance.positionY + Math.sin(angle) * distance)
                await MooseAgentInstance.move({ instanceID: allSiblings[i].id, x: newX, y: newY })
              }

              // Run repulsion pass to push apart any overlapping nodes across the whole canvas
              await MooseAgentInstance.repelOverlaps(parentMooseInstance.workspaceSessionID)
            }
          }
        }
        // Set the instance (reused or newly created) to working
        if (mooseChildInstance) {
          await MooseAgentInstance.setState({ instanceID: mooseChildInstance.id, state: "working" })
        }
      } catch {
        // Non-fatal: canvas visualization is optional
      }

      log.info("session resolved", {
        sessionID: session.id,
        reused: reuseExistingSession,
        childInstanceID: mooseChildInstance?.id,
      })

      // Seed initial todo for the child session: the assigned task becomes an in_progress todo.
      // This lets the user see what the child is working on in the todo panel.
      try {
        const existingTodos = Todo.get(session.id)
        if (existingTodos.length === 0) {
          Todo.update({
            sessionID: session.id,
            todos: [
              {
                content: params.description,
                status: "in_progress",
                priority: "high",
              },
            ],
          })
          log.info("seeded initial todo for child session", {
            sessionID: session.id,
            description: params.description,
          })
        }
      } catch {
        // Non-fatal: todo seeding is optional
      }

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      log.info("model resolved", {
        subagent: params.subagent_type,
        modelID: model.modelID,
        providerID: model.providerID,
        source: agent.model ? "agent-definition" : "parent-message",
      })

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const messageID = Identifier.ascending("message")

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
      try {
        result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            ...(childIsOrchestrator ? {} : { todowrite: false, todoread: false }),
            ...(hasTaskPermission ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })
      } catch (err) {
        log.error("task.execute FAILED", {
          subagent: params.subagent_type,
          error: err instanceof Error ? err.message : String(err),
        })
        // Set child to error state if task execution fails
        if (mooseChildInstance) {
          try {
            await MooseAgentInstance.setState({ instanceID: mooseChildInstance.id, state: "error" })
          } catch {
            // Non-fatal
          }
        }
        // Mark seeded todos as cancelled on failure
        try {
          const childTodos = Todo.get(session.id)
          if (childTodos.length > 0) {
            const updatedTodos = childTodos.map((t) => ({
              ...t,
              status: t.status === "pending" || t.status === "in_progress" ? "cancelled" : t.status,
            }))
            Todo.update({ sessionID: session.id, todos: updatedTodos })
          }
        } catch {
          // Non-fatal
        }
        throw err
      }

      log.info("task.execute COMPLETE", {
        subagent: params.subagent_type,
        sessionID: session.id,
        childInstanceID: mooseChildInstance?.id,
      })

      // Reset child to idle when task completes successfully
      if (mooseChildInstance) {
        try {
          await MooseAgentInstance.setState({ instanceID: mooseChildInstance.id, state: "idle" })
        } catch {
          // Non-fatal
        }
      }

      // Mark all pending/in_progress todos as completed for the child session.
      // This is critical for leaf agents (e.g., Deer) that have todowrite denied
      // and can't update their own seeded todo.
      try {
        const childTodos = Todo.get(session.id)
        if (childTodos.length > 0) {
          const updatedTodos = childTodos.map((t) => ({
            ...t,
            status: t.status === "pending" || t.status === "in_progress" ? "completed" : t.status,
          }))
          Todo.update({ sessionID: session.id, todos: updatedTodos })
        }
      } catch {
        // Non-fatal
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
