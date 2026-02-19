import z from "zod"
import { Identifier } from "@/id/id"

// ===== Agent Definition Schemas =====

export const AgentDefinitionInfo = z
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
export type AgentDefinitionInfo = z.infer<typeof AgentDefinitionInfo>
export type AgentDefinitionInput = z.input<typeof AgentDefinitionInfo>

export const AgentFolder = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().default("#9C27B0"),
  agents: z.array(AgentDefinitionInfo),
})
export type AgentFolder = z.infer<typeof AgentFolder>

export const AgentFolderConfig = z.object({
  activeFolder: z.string(),
  folders: z.array(AgentFolder),
})
export type AgentFolderConfig = z.infer<typeof AgentFolderConfig>

// ===== Agent Instance Schemas =====

export const AgentInstanceState = z.enum(["idle", "working", "error", "question", "spawning"])
export type AgentInstanceState = z.infer<typeof AgentInstanceState>

export const AgentInstanceInfo = z
  .object({
    id: Identifier.schema("agent_instance"),
    workspaceSessionID: z.string(),
    agentDefinitionID: z.string(),
    sessionID: z.string().optional(),
    parentInstanceID: z.string().optional(),
    positionX: z.number(),
    positionY: z.number(),
    state: AgentInstanceState,
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
export type AgentInstanceInfo = z.infer<typeof AgentInstanceInfo>

// ===== Communication Schemas =====

export const AgentMessageType = z.enum(["question", "scope_request", "answer", "result"])
export type AgentMessageType = z.infer<typeof AgentMessageType>
