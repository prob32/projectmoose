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
      permissionMode: z.enum(["build", "plan"]).default("build"),
      thinking: z
        .object({
          budget: z.number().int().positive().optional(),
          effort: z.string().optional(),
        })
        .optional(),
      mcp: z
        .object({
          servers: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        })
        .optional(),
      tools: z
        .object({
          mode: z.enum(["all", "scoped"]).default("all"),
          allow: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        })
        .optional(),
      skills: z.array(z.string()).optional(),
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

  // ===== Folder Schema =====
  export const Folder = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    color: z.string().default("#9C27B0"),
    agents: z.array(Info),
  })
  export type Folder = z.infer<typeof Folder>

  export const FolderConfig = z.object({
    activeFolder: z.string(),
    folders: z.array(Folder),
  })
  export type FolderConfig = z.infer<typeof FolderConfig>

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

  /** Normalize config: supports both legacy flat array and new folder schema */
  function normalizeConfig(raw: any): FolderConfig {
    if (Array.isArray(raw)) {
      // Legacy flat array — wrap in a single "custom" folder
      return {
        activeFolder: "custom",
        folders: [
          {
            id: "custom",
            name: "Custom",
            color: "#9C27B0",
            agents: z.array(Info).parse(raw),
          },
        ],
      }
    }
    return FolderConfig.parse(raw)
  }

  async function readConfig(): Promise<FolderConfig> {
    try {
      const raw = await fs.readFile(configPath(), "utf-8")
      const parsed = JSON.parse(raw)
      return normalizeConfig(parsed)
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return { activeFolder: "default", folders: [] }
      }
      log.error("failed to read moose-agents.json", { error: e })
      return { activeFolder: "default", folders: [] }
    }
  }

  async function writeConfig(config: FolderConfig) {
    const dir = path.dirname(configPath())
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(configPath(), JSON.stringify(config, null, 2), "utf-8")
    log.info("wrote moose-agents.json", { folders: config.folders.length })
    // Publish active folder's agents as the definitions update
    const activeFolder = config.folders.find((f) => f.id === config.activeFolder)
    if (activeFolder) {
      await Bus.publish(Event.Updated, { definitions: activeFolder.agents })
    }
  }

  /** Get the active folder's agents (backward-compatible list endpoint) */
  async function readFile(): Promise<Info[]> {
    const config = await readConfig()
    const folder = config.folders.find((f) => f.id === config.activeFolder)
    return folder?.agents ?? config.folders[0]?.agents ?? []
  }

  /** Write agents to the active folder (backward-compatible write) */
  async function writeFile(definitions: Info[]) {
    const config = await readConfig()
    const folderIdx = config.folders.findIndex((f) => f.id === config.activeFolder)
    if (folderIdx >= 0) {
      config.folders[folderIdx].agents = definitions
    } else if (config.folders.length > 0) {
      config.folders[0].agents = definitions
    } else {
      config.folders.push({ id: "custom", name: "Custom", color: "#9C27B0", agents: definitions })
      config.activeFolder = "custom"
    }
    await writeConfig(config)
  }

  // ===== Folder CRUD =====

  export async function listFolders(): Promise<FolderConfig> {
    return readConfig()
  }

  export async function getFolder(id: string): Promise<Folder | undefined> {
    const config = await readConfig()
    return config.folders.find((f) => f.id === id)
  }

  export async function createFolder(folder: Folder): Promise<Folder> {
    const config = await readConfig()
    if (config.folders.find((f) => f.id === folder.id)) {
      throw new Error(`Folder "${folder.id}" already exists`)
    }
    config.folders.push(folder)
    await writeConfig(config)
    return folder
  }

  export async function updateFolder(id: string, updates: Partial<Omit<Folder, "id">>): Promise<Folder> {
    const config = await readConfig()
    const idx = config.folders.findIndex((f) => f.id === id)
    if (idx === -1) throw new Error(`Folder "${id}" not found`)
    config.folders[idx] = { ...config.folders[idx], ...updates, id }
    await writeConfig(config)
    return config.folders[idx]
  }

  export async function removeFolder(id: string): Promise<void> {
    const config = await readConfig()
    const idx = config.folders.findIndex((f) => f.id === id)
    if (idx === -1) throw new Error(`Folder "${id}" not found`)
    config.folders.splice(idx, 1)
    // If we removed the active folder, switch to the first available
    if (config.activeFolder === id && config.folders.length > 0) {
      config.activeFolder = config.folders[0].id
    }
    await writeConfig(config)
  }

  export async function setActiveFolder(folderId: string): Promise<FolderConfig> {
    const config = await readConfig()
    if (!config.folders.find((f) => f.id === folderId)) {
      throw new Error(`Folder "${folderId}" not found`)
    }
    config.activeFolder = folderId
    await writeConfig(config)
    return config
  }

  export async function list(): Promise<Info[]> {
    return readFile()
  }

  /** Find an agent by ID across ALL folders, returning the folder index and agent index */
  async function findAgentAcrossFolders(config: FolderConfig, id: string): Promise<{ folderIdx: number; agentIdx: number } | undefined> {
    for (let fi = 0; fi < config.folders.length; fi++) {
      const ai = config.folders[fi].agents.findIndex((a) => a.id === id)
      if (ai !== -1) return { folderIdx: fi, agentIdx: ai }
    }
    return undefined
  }

  export async function get(id: string): Promise<Info | undefined> {
    const config = await readConfig()
    for (const folder of config.folders) {
      const found = folder.agents.find((a) => a.id === id)
      if (found) return found
    }
    return undefined
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
    const config = await readConfig()
    const loc = await findAgentAcrossFolders(config, id)
    if (!loc) {
      throw new Error(`Agent definition "${id}" not found`)
    }
    const existing = config.folders[loc.folderIdx].agents[loc.agentIdx]
    const updated = Info.parse({ ...existing, ...input, id })
    config.folders[loc.folderIdx].agents[loc.agentIdx] = updated
    await writeConfig(config)
    log.info("updated agent definition", { id, folder: config.folders[loc.folderIdx].id })
    return updated
  }

  export async function remove(id: string): Promise<void> {
    const config = await readConfig()
    const loc = await findAgentAcrossFolders(config, id)
    if (!loc) {
      throw new Error(`Agent definition "${id}" not found`)
    }
    config.folders[loc.folderIdx].agents.splice(loc.agentIdx, 1)
    await writeConfig(config)
    log.info("removed agent definition", { id, folder: config.folders[loc.folderIdx].id })
  }

  // ===== Moose Herd Agents (original hierarchy) =====
  const MOOSE_HERD_AGENTS: Info[] = [
    {
      id: "bull_moose", name: "Bull Moose",
      description: "Head orchestrator — coordinates all agent activity",
      color: "#8B4513", role: "orchestrator",
      prompt: "You are the Bull Moose, the head orchestrator agent. Your job is to break down complex user requests into subtasks, delegate them to specialized child agents, and synthesize their results into a coherent response. You coordinate Junior Moose sub-orchestrators, Smart Moose researchers, Debug Moose debuggers, Trail Moose general-purpose agents, and Scout Moose exploration agents. Always think step-by-step about how to decompose work efficiently.",
      spawnable: { agents: ["junior_moose", "smart_moose", "debug_moose", "trail_moose", "scout_moose"], limit: "auto" as const },
      idle_timeout: 0, order: 0,
    },
    {
      id: "junior_moose", name: "Junior Moose",
      description: "Sub-orchestrator — subdivides tasks for coding agents",
      color: "#FF6B35", role: "sub_orchestrator",
      prompt: "You are Junior Moose, a sub-orchestrator agent. You receive tasks from Bull Moose and break them into specific coding subtasks for Deer coding agents. You review their outputs, request revisions if needed, and assemble the final result. Focus on clear, actionable task descriptions for your Deer agents.",
      spawnable: { agents: ["deer"], limit: 5 },
      idle_timeout: 120, order: 1,
    },
    {
      id: "deer", name: "Deer",
      description: "Focused coding agent — writes and edits code",
      color: "#4CAF50", role: "coder",
      prompt: "You are Deer, a focused coding agent. You receive specific coding tasks and execute them precisely. Write clean, well-documented code. When your task is complete, return the result to your parent agent. You cannot spawn other agents — focus solely on the coding task at hand.",
      idle_timeout: 90, order: 2,
    },
    {
      id: "smart_moose", name: "Smart Moose",
      description: "Research specialist — gathers information and context",
      color: "#2196F3", role: "researcher",
      prompt: "You are Smart Moose, a research specialist agent. You investigate codebases, read documentation, and gather context needed for decision-making. Provide thorough, well-organized summaries of your findings. You work under Bull Moose and report back with actionable intelligence.",
      idle_timeout: 120, order: 3,
    },
    {
      id: "debug_moose", name: "Debug Moose",
      description: "Debugging specialist — diagnoses and fixes issues",
      color: "#E91E63", role: "debugger",
      prompt: "You are Debug Moose, a debugging specialist agent. You analyze error messages, trace through code paths, identify root causes, and propose fixes. Be systematic: reproduce the issue, identify the cause, implement the fix, and verify it works. Report your findings and fix back to your parent agent.",
      idle_timeout: 120, order: 4,
    },
    {
      id: "trail_moose", name: "Trail Moose",
      description: "General-purpose agent — researches questions and executes multi-step tasks",
      color: "#9C27B0", role: "general",
      prompt: "You are Trail Moose, a general-purpose agent. You handle complex research questions, execute multi-step tasks, and can work in parallel with other agents. You are versatile and capable of tackling any task that doesn't require specialized skills. Provide thorough, actionable results to your parent agent.",
      idle_timeout: 120, order: 5,
    },
    {
      id: "scout_moose", name: "Scout Moose",
      description: "Codebase explorer — fast search, pattern matching, and file discovery",
      color: "#00BCD4", role: "explorer",
      prompt: "You are Scout Moose, a fast codebase exploration specialist. You quickly find files by patterns, search code for keywords, trace through imports and dependencies, and answer questions about the codebase structure. Use glob, grep, and read tools efficiently. Provide concise, well-organized findings.",
      idle_timeout: 90, order: 6,
    },
  ]

  // ===== Default Folder Agents (Kilo Code-derived) =====
  const DEFAULT_AGENTS: Info[] = [
    {
      id: "architect", name: "Architect",
      description: "Plan and design before implementation",
      color: "#FF9800", role: "orchestrator",
      prompt: "You are an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before implementation begins.\n\n## Instructions\n\n1. Do information gathering (using provided tools) to get more context about the task.\n2. Ask the user clarifying questions to get a better understanding of the task.\n3. Once you've gained context, break down the task into clear, actionable steps. Each step should be specific, listed in logical execution order, focused on a single well-defined outcome, and clear enough that another agent could execute it independently.\n4. As you gather more information or discover new requirements, update the plan to reflect the current understanding.\n5. Ask the user if they are pleased with this plan, or if they would like to make any changes.\n6. Include Mermaid diagrams if they help clarify complex workflows or system architecture.\n\nFocus on creating clear, actionable plans rather than lengthy documents. Never provide level-of-effort time estimates for tasks.",
      tools: { mode: "scoped", allow: ["read", "browser", "planning", "interaction", "skills", "task"] },
      spawnable: { agents: ["coder", "ask", "debugger"], limit: "auto" as const },
      idle_timeout: 0, order: 0,
    },
    {
      id: "coder", name: "Coder",
      description: "Write, modify, and refactor code",
      color: "#4CAF50", role: "coder",
      prompt: "You are a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.\n\nYour job is to write, modify, and refactor code with precision. Follow existing patterns and conventions in the codebase. Make minimal, focused changes. Read surrounding code before editing to understand context. Write clean, well-structured code and explain non-obvious decisions in comments.\n\nWhen given a task:\n1. Read the relevant files first to understand existing patterns\n2. Make the minimum changes needed to accomplish the goal\n3. Follow the project's existing code style and conventions\n4. Test your changes if testing infrastructure is available\n5. Report back what you changed and why",
      tools: { mode: "scoped", allow: ["read", "edit", "command", "planning", "interaction", "skills"] },
      idle_timeout: 90, order: 1,
    },
    {
      id: "ask", name: "Ask",
      description: "Get answers and explanations",
      color: "#2196F3", role: "researcher",
      prompt: "You are a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.\n\nYou can analyze code, explain concepts, and access external resources. Always answer the user's questions thoroughly, and do not switch to implementing code unless explicitly requested.\n\nWhen answering:\n1. Read relevant source files to ground your answers in the actual codebase\n2. Provide specific file references and line numbers when discussing code\n3. Explain both the what and the why\n4. If you're uncertain about something, say so and suggest how to verify",
      tools: { mode: "scoped", allow: ["read", "browser", "interaction", "skills"] },
      idle_timeout: 120, order: 2,
    },
    {
      id: "debugger", name: "Debugger",
      description: "Diagnose and fix software issues",
      color: "#E91E63", role: "debugger",
      prompt: "You are an expert software debugger specializing in systematic problem diagnosis and resolution.\n\nWhen debugging:\n1. Reflect on 5-7 different possible sources of the problem\n2. Distill those down to 1-2 most likely sources\n3. Add logs or use tools to validate your assumptions\n4. Explicitly confirm the diagnosis before fixing the problem\n5. Implement a targeted fix\n6. Verify the fix doesn't introduce regressions\n\nBe systematic: reproduce the issue, identify the cause, implement the fix, and verify it works.",
      tools: { mode: "scoped", allow: ["read", "edit", "command", "browser", "planning", "interaction", "skills"] },
      idle_timeout: 120, order: 3,
    },
    {
      id: "reviewer", name: "Reviewer",
      description: "Review code changes locally",
      color: "#9C27B0", role: "general",
      prompt: "You are an expert code reviewer with deep expertise in software engineering best practices, security vulnerabilities, performance optimization, and code quality. Your role is advisory — provide clear, actionable feedback.\n\n## How to Review\n\n1. Start with git diff to see the actual changes.\n2. Examine specific files for complex changes.\n3. Gather history context when needed.\n4. Be confident: only flag issues where you have high confidence.\n   - CRITICAL (95%+): Security vulnerabilities, data loss risks, crashes\n   - WARNING (85%+): Bugs, logic errors, performance issues\n   - SUGGESTION (75%+): Code quality improvements\n5. Focus on what matters: security, bugs, performance, error handling.\n\n## Output Format\n\n### Summary\n2-3 sentences on what changed and your overall assessment.\n\n### Issues Found\n| Severity | File:Line | Issue |\n\n### Recommendation\nOne of: APPROVE | APPROVE WITH SUGGESTIONS | NEEDS CHANGES",
      tools: { mode: "scoped", allow: ["read", "command", "interaction"] },
      idle_timeout: 120, order: 4,
    },
    {
      id: "orchestrator", name: "Orchestrator",
      description: "Coordinate tasks across multiple agents",
      color: "#78909C", role: "orchestrator",
      prompt: "You are a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized agents.\n\n## Instructions\n\n1. When given a complex task, break it down into logical subtasks that can be delegated to appropriate specialized agents.\n2. For each subtask, spawn the most appropriate agent and provide comprehensive instructions including all necessary context, a clearly defined scope, and an explicit statement that the subtask should only perform the outlined work.\n3. Track and manage the progress of all subtasks.\n4. When all subtasks are completed, synthesize the results and provide a comprehensive overview.\n5. Ask clarifying questions when necessary.",
      tools: { mode: "scoped", allow: ["read", "task", "planning", "interaction"] },
      spawnable: { agents: ["architect", "coder", "ask", "debugger", "reviewer"], limit: "auto" as const },
      idle_timeout: 0, order: 5,
    },
  ]

  /** Seed default folders if config is empty (first-run experience) */
  export async function seedDefaults(): Promise<void> {
    const config = await readConfig()
    if (config.folders.length > 0) return // Don't overwrite

    log.info("seeding default agent folders")
    config.activeFolder = "default"
    config.folders = [
      {
        id: "default",
        name: "Default",
        description: "Traditional dev agents — architect, code, ask, debug, review, orchestrate",
        icon: "terminal",
        color: "#64b5f6",
        agents: DEFAULT_AGENTS,
      },
      {
        id: "moose_herd",
        name: "Moose Herd",
        description: "Orchestrator hierarchy with Bull Moose at the top",
        icon: "moose",
        color: "#8B4513",
        agents: MOOSE_HERD_AGENTS,
      },
    ]
    await writeConfig(config)
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
