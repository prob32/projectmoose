import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Discovery } from "../../skill/discovery"
import { Skill } from "../../skill/skill"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const RegistryCatalogEntry = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  source: z.string(),
  installed: z.boolean(),
})

export const SkillRegistryRoutes = lazy(() =>
  new Hono()
    .get(
      "/registry",
      describeRoute({
        summary: "List registry catalog",
        description: "Returns the merged catalog from all configured skill registry URLs without downloading anything.",
        operationId: "skill.registry.list",
        responses: {
          200: {
            description: "Registry catalog entries",
            content: {
              "application/json": {
                schema: resolver(RegistryCatalogEntry.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const urls = config.skills?.urls ?? []
        const installed = await Skill.all()
        const installedNames = new Set(installed.map((s) => s.name))

        const results = await Promise.all(
          urls.map(async (url) => {
            const entries = await Discovery.list(url)
            return entries.map((entry) => ({
              name: entry.name,
              description: entry.description,
              tags: entry.tags,
              source: url,
              installed: installedNames.has(entry.name),
            }))
          }),
        )

        // Flatten and deduplicate (first source wins)
        const seen = new Set<string>()
        const catalog = results.flat().filter((entry) => {
          if (seen.has(entry.name)) return false
          seen.add(entry.name)
          return true
        })

        return c.json(catalog)
      },
    )
    .post(
      "/install",
      describeRoute({
        summary: "Install a skill from a registry",
        description: "Downloads a specific skill by name from a registry URL.",
        operationId: "skill.registry.install",
        responses: {
          200: {
            description: "Installed skill info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.literal(true),
                    skill: Skill.Info,
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          source: z.string(),
        }),
      ),
      async (c) => {
        const { name, source } = c.req.valid("json")
        const skillDir = await Discovery.install(source, name)
        if (!skillDir) {
          return c.json({ ok: false, error: "Skill not found in registry" }, 404)
        }

        // Invalidate cache so the newly installed skill is picked up
        Skill.invalidate()
        const skill = await Skill.get(name)
        if (!skill) {
          return c.json({ ok: false, error: "Skill installed but failed to load" }, 400)
        }

        return c.json({ ok: true, skill })
      },
    )
    .delete(
      "/uninstall",
      describeRoute({
        summary: "Uninstall a skill",
        description: "Removes a previously installed skill from the cache directory.",
        operationId: "skill.registry.uninstall",
        responses: {
          200: { description: "Uninstalled" },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
        }),
      ),
      async (c) => {
        const { name } = c.req.valid("json")

        // Verify the skill exists and is in the cache directory
        const skill = await Skill.get(name)
        if (!skill) {
          return c.json({ ok: false, error: "Skill not found" }, 404)
        }

        const cacheDir = Discovery.dir()
        if (!skill.location.startsWith(cacheDir)) {
          return c.json({ ok: false, error: "Can only uninstall registry-installed skills" }, 400)
        }

        const removed = await Discovery.uninstall(name)
        if (!removed) {
          return c.json({ ok: false, error: "Failed to remove skill" }, 400)
        }

        Skill.invalidate()
        return c.json({ ok: true })
      },
    ),
)
