import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { ApplyPatchTool } from "./apply_patch"

/** Tool groups for the tool scoping UI — maps group name to individual tool IDs */
export const TOOL_GROUPS: Record<string, { label: string; tools: Array<{ id: string; name: string; description: string }> }> = {
  read: {
    label: "Read & Search",
    tools: [
      { id: "read", name: "Read File", description: "Read file contents" },
      { id: "glob", name: "Find Files", description: "Find files by glob pattern" },
      { id: "grep", name: "Search", description: "Search file contents with regex" },
      { id: "codesearch", name: "Code Search", description: "Semantic code search" },
      { id: "lsp", name: "LSP", description: "Language server protocol" },
    ],
  },
  edit: {
    label: "Edit & Write",
    tools: [
      { id: "edit", name: "Edit File", description: "Modify existing files" },
      { id: "write", name: "Write File", description: "Create new files" },
      { id: "apply_patch", name: "Apply Patch", description: "Apply unified diffs" },
    ],
  },
  command: {
    label: "Shell",
    tools: [
      { id: "bash", name: "Terminal", description: "Execute shell commands" },
    ],
  },
  browser: {
    label: "Web Access",
    tools: [
      { id: "webfetch", name: "Web Fetch", description: "Fetch URL content" },
      { id: "websearch", name: "Web Search", description: "Search the web" },
    ],
  },
  task: {
    label: "Subtasks",
    tools: [
      { id: "task", name: "Task", description: "Spawn subtask agent" },
    ],
  },
  planning: {
    label: "Planning",
    tools: [
      { id: "todoread", name: "Read Todos", description: "Read todo list" },
      { id: "todowrite", name: "Write Todos", description: "Update todo list" },
    ],
  },
  interaction: {
    label: "Interaction",
    tools: [
      { id: "question", name: "Question", description: "Ask user a question" },
    ],
  },
  skills: {
    label: "Skills",
    tools: [
      { id: "skill", name: "Skill", description: "Load skill content" },
    ],
  },
}

/** Expand group names and individual tool IDs into a flat set of tool IDs */
export function expandToolGroups(items: string[]): Set<string> {
  const result = new Set<string>()
  for (const item of items) {
    const group = TOOL_GROUPS[item]
    if (group) {
      for (const tool of group.tools) result.add(tool.id)
    } else {
      result.add(item)
    }
  }
  return result
}

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) => [...glob.scanSync({ cwd: dir, absolute: true, followSymlinks: true, dot: true })]),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      const mod = await import(match)
      for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
        custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          const result = await def.execute(args as any, pluginCtx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      InvalidTool,
      ...(["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      // TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA
          }

          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          const tool = await t.init({ agent })
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          await Plugin.trigger("tool.definition", { toolID: t.id }, output)
          return {
            id: t.id,
            ...tool,
            description: output.description,
            parameters: output.parameters,
          }
        }),
    )
    return result
  }
}
