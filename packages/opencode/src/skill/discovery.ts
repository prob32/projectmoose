import path from "path"
import { mkdir, rm } from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })

  export type IndexEntry = {
    name: string
    description: string
    files: string[]
    tags?: string[]
  }

  type Index = {
    skills: IndexEntry[]
  }

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  async function get(url: string, dest: string): Promise<boolean> {
    if (await Bun.file(dest).exists()) return true
    return fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to download", { url, status: response.status })
          return false
        }
        await Bun.write(dest, await response.text())
        return true
      })
      .catch((err) => {
        log.error("failed to download", { url, err })
        return false
      })
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href
    const cache = dir()
    const host = base.slice(0, -1)

    log.info("fetching index", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => json as Index)
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) {
      log.warn("invalid index format", { url: index })
      return result
    }

    const list = data.skills.filter((skill) => {
      if (!skill?.name || !Array.isArray(skill.files)) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      return true
    })

    await Promise.all(
      list.map(async (skill) => {
        const root = path.join(cache, skill.name)
        await Promise.all(
          skill.files.map(async (file) => {
            const link = new URL(file, `${host}/${skill.name}/`).href
            const dest = path.join(root, file)
            await mkdir(path.dirname(dest), { recursive: true })
            await get(link, dest)
          }),
        )

        const md = path.join(root, "SKILL.md")
        if (await Bun.file(md).exists()) result.push(root)
      }),
    )

    return result
  }

  /** Fetch a registry index without downloading any files. */
  export async function list(url: string): Promise<IndexEntry[]> {
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href

    log.info("listing registry", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => json as Index)
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) return []
    return data.skills.filter((s) => s?.name && Array.isArray(s.files))
  }

  /** Download a single skill by name from a registry URL. Returns the skill directory or undefined on failure. */
  export async function install(url: string, skillName: string): Promise<string | undefined> {
    const entries = await list(url)
    const entry = entries.find((e) => e.name === skillName)
    if (!entry) {
      log.warn("skill not found in registry", { url, skillName })
      return undefined
    }

    const base = url.endsWith("/") ? url : `${url}/`
    const host = base.slice(0, -1)
    const cache = dir()
    const root = path.join(cache, entry.name)

    await Promise.all(
      entry.files.map(async (file) => {
        const link = new URL(file, `${host}/${entry.name}/`).href
        const dest = path.join(root, file)
        await mkdir(path.dirname(dest), { recursive: true })
        // Force download (overwrite existing) for install
        const response = await fetch(link)
        if (!response.ok) {
          log.error("failed to download skill file", { link, status: response.status })
          return
        }
        await Bun.write(dest, await response.text())
      }),
    )

    const md = path.join(root, "SKILL.md")
    if (await Bun.file(md).exists()) return root
    log.warn("installed skill missing SKILL.md", { root })
    return undefined
  }

  /** Remove a skill from the cache directory. Only deletes skills under the cache dir. */
  export async function uninstall(skillName: string): Promise<boolean> {
    const cache = dir()
    const root = path.join(cache, skillName)
    // Safety: only remove skills in our cache directory
    if (!root.startsWith(cache)) {
      log.error("refusing to uninstall skill outside cache dir", { root, cache })
      return false
    }
    try {
      await rm(root, { recursive: true, force: true })
      return true
    } catch (err) {
      log.error("failed to uninstall skill", { skillName, err })
      return false
    }
  }
}
