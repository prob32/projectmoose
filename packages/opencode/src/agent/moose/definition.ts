import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Log } from "../../util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

export namespace MooseAgentDefinition {
  const log = Log.create({ service: "moose.definition" })

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      prompt: z.string(),
      role: z.string().optional(),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      temperature: z.number().optional(),
      mcp: z
        .object({
          servers: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        })
        .optional(),
      spawnable: z
        .object({
          agents: z.array(z.string()),
          limit: z.union([z.number().int().positive(), z.literal("auto")]).default("auto"),
        })
        .optional(),
      idle_timeout: z.number().default(120),
      order: z.number().default(0),
    })
    .meta({
      ref: "MooseAgentDefinition",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "moose.definition.updated",
      z.object({
        definitions: z.array(Info),
      }),
    ),
  }

  function configPath() {
    return path.join(Global.Path.config, "moose-agents.json")
  }

  async function readFile(): Promise<Info[]> {
    try {
      const raw = await fs.readFile(configPath(), "utf-8")
      const parsed = JSON.parse(raw)
      const result = z.array(Info).parse(parsed)
      return result
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return []
      }
      log.error("failed to read moose-agents.json", { error: e })
      return []
    }
  }

  async function writeFile(definitions: Info[]) {
    const dir = path.dirname(configPath())
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(configPath(), JSON.stringify(definitions, null, 2), "utf-8")
    log.info("wrote moose-agents.json", { count: definitions.length })
    await Bus.publish(Event.Updated, { definitions })
  }

  export async function list(): Promise<Info[]> {
    return readFile()
  }

  export async function get(id: string): Promise<Info | undefined> {
    const all = await readFile()
    return all.find((a) => a.id === id)
  }

  export async function create(input: Info): Promise<Info> {
    const all = await readFile()
    if (all.find((a) => a.id === input.id)) {
      throw new Error(`Agent definition with id "${input.id}" already exists`)
    }
    const validated = Info.parse(input)
    all.push(validated)
    await writeFile(all)
    log.info("created agent definition", { id: validated.id })
    return validated
  }

  export async function update(id: string, input: Partial<Omit<Info, "id">>): Promise<Info> {
    const all = await readFile()
    const index = all.findIndex((a) => a.id === id)
    if (index === -1) {
      throw new Error(`Agent definition "${id}" not found`)
    }
    const updated = Info.parse({ ...all[index], ...input, id })
    all[index] = updated
    await writeFile(all)
    log.info("updated agent definition", { id })
    return updated
  }

  export async function remove(id: string): Promise<void> {
    const all = await readFile()
    const index = all.findIndex((a) => a.id === id)
    if (index === -1) {
      throw new Error(`Agent definition "${id}" not found`)
    }
    all.splice(index, 1)
    await writeFile(all)
    log.info("removed agent definition", { id })
  }

  /** Default agent types — seeded on first run when no definitions exist.
   *  Includes the core Moose hierarchy plus Moose-flavored versions of
   *  the built-in opencode agents (general-purpose & explore). */
  const DEFAULT_DEFINITIONS: Info[] = [
    // ── Core Moose Hierarchy ──────────────────────────────────────────
    {
      id: "bull_moose",
      name: "Bull Moose",
      description: "Head orchestrator — coordinates all agent activity",
      color: "#8B4513",
      prompt:
        "You are the Bull Moose, the head orchestrator agent. Your job is to break down complex user requests into subtasks, delegate them to specialized child agents, and synthesize their results into a coherent response. You coordinate Junior Moose sub-orchestrators, Smart Moose researchers, Debug Moose debuggers, Trail Moose general-purpose agents, and Scout Moose exploration agents. Always think step-by-step about how to decompose work efficiently.",
      role: "orchestrator",
      spawnable: {
        agents: ["junior_moose", "smart_moose", "debug_moose", "trail_moose", "scout_moose"],
        limit: "auto" as const,
      },
      idle_timeout: 0,
      order: 0,
    },
    {
      id: "junior_moose",
      name: "Junior Moose",
      description: "Sub-orchestrator — subdivides tasks for coding agents",
      color: "#FF6B35",
      prompt:
        "You are Junior Moose, a sub-orchestrator agent. You receive tasks from Bull Moose and break them into specific coding subtasks for Deer coding agents. You review their outputs, request revisions if needed, and assemble the final result. Focus on clear, actionable task descriptions for your Deer agents.",
      role: "sub_orchestrator",
      spawnable: { agents: ["deer"], limit: 5 },
      idle_timeout: 120,
      order: 1,
    },
    {
      id: "deer",
      name: "Deer",
      description: "Focused coding agent — writes and edits code",
      color: "#4CAF50",
      prompt:
        "You are Deer, a focused coding agent. You receive specific coding tasks and execute them precisely. Write clean, well-documented code. When your task is complete, return the result to your parent agent. You cannot spawn other agents — focus solely on the coding task at hand.",
      role: "coder",
      idle_timeout: 90,
      order: 2,
    },
    {
      id: "smart_moose",
      name: "Smart Moose",
      description: "Research specialist — gathers information and context",
      color: "#2196F3",
      prompt:
        "You are Smart Moose, a research specialist agent. You investigate codebases, read documentation, and gather context needed for decision-making. Provide thorough, well-organized summaries of your findings. You work under Bull Moose and report back with actionable intelligence.",
      role: "researcher",
      idle_timeout: 120,
      order: 3,
    },
    {
      id: "debug_moose",
      name: "Debug Moose",
      description: "Debugging specialist — diagnoses and fixes issues",
      color: "#E91E63",
      prompt:
        "You are Debug Moose, a debugging specialist agent. You analyze error messages, trace through code paths, identify root causes, and propose fixes. Be systematic: reproduce the issue, identify the cause, implement the fix, and verify it works. Report your findings and fix back to your parent agent.",
      role: "debugger",
      idle_timeout: 120,
      order: 4,
    },
    // ── Moose versions of built-in opencode agents ────────────────────
    {
      id: "trail_moose",
      name: "Trail Moose",
      description: "General-purpose agent — researches questions and executes multi-step tasks",
      color: "#9C27B0",
      prompt:
        "You are Trail Moose, a general-purpose agent. You handle complex research questions, execute multi-step tasks, and can work in parallel with other agents. You are versatile and capable of tackling any task that doesn't require specialized skills. Provide thorough, actionable results to your parent agent.",
      role: "general",
      idle_timeout: 120,
      order: 5,
    },
    {
      id: "scout_moose",
      name: "Scout Moose",
      description: "Codebase explorer — fast search, pattern matching, and file discovery",
      color: "#00BCD4",
      prompt:
        "You are Scout Moose, a fast codebase exploration specialist. You quickly find files by patterns, search code for keywords, trace through imports and dependencies, and answer questions about the codebase structure. Use glob, grep, and read tools efficiently. Provide concise, well-organized findings. When exploring, specify thoroughness: quick for basic searches, medium for moderate exploration, or thorough for comprehensive analysis.",
      role: "explorer",
      idle_timeout: 90,
      order: 6,
    },
  ]

  /** Seed default agent definitions if none exist (first-run experience) */
  export async function seedDefaults(): Promise<void> {
    const existing = await readFile()
    if (existing.length > 0) return // Don't overwrite user's definitions

    log.info("seeding default agent definitions", { count: DEFAULT_DEFINITIONS.length })
    for (const def of DEFAULT_DEFINITIONS) {
      try {
        await create(def)
      } catch (e) {
        log.warn("failed to seed default definition", { id: def.id, error: e })
      }
    }
  }

  export async function reorder(orderedIds: string[]): Promise<Info[]> {
    const all = await readFile()
    const reordered = orderedIds
      .map((id, index) => {
        const def = all.find((a) => a.id === id)
        if (!def) return undefined
        return { ...def, order: index }
      })
      .filter(Boolean) as Info[]

    // Append any definitions not in the ordered list
    for (const def of all) {
      if (!orderedIds.includes(def.id)) {
        reordered.push(def)
      }
    }

    await writeFile(reordered)
    return reordered
  }
}
