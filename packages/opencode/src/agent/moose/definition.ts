import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Log } from "../../util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import {
  AgentDefinitionInfo,
  AgentFolder,
  AgentFolderConfig,
} from "./schema"
import { DEFAULT_AGENTS } from "./presets/default"
import { MOOSE_HERD_AGENTS } from "./presets/moose-herd"

export namespace MooseAgentDefinition {
  const log = Log.create({ service: "moose.definition" })

  // Re-export schemas under original names for backward compatibility
  export const Info = AgentDefinitionInfo
  export type Info = AgentDefinitionInfo
  export const Folder = AgentFolder
  export type Folder = AgentFolder
  export const FolderConfig = AgentFolderConfig
  export type FolderConfig = AgentFolderConfig

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
        agents: DEFAULT_AGENTS as Info[],
      },
      {
        id: "moose_herd",
        name: "Moose Herd",
        description: "Orchestrator hierarchy with Bull Moose at the top",
        icon: "moose",
        color: "#8B4513",
        agents: MOOSE_HERD_AGENTS as Info[],
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
