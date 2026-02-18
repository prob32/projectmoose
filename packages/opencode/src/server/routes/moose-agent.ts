import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MooseAgentDefinition } from "../../agent/moose/definition"
import { Agent } from "../../agent/agent"
import { TOOL_GROUPS } from "../../tool/registry"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

// ===== Folder Routes =====
export const MooseAgentFolderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all agent folders",
        operationId: "moose.agent.folder.list",
        responses: { 200: { description: "Folder config" } },
      }),
      async (c) => {
        const config = await MooseAgentDefinition.listFolders()
        return c.json(config)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create agent folder",
        operationId: "moose.agent.folder.create",
        responses: { 200: { description: "Created folder" }, ...errors(400) },
      }),
      validator("json", MooseAgentDefinition.Folder),
      async (c) => {
        const folder = await MooseAgentDefinition.createFolder(c.req.valid("json"))
        return c.json(folder)
      },
    )
    .put(
      "/:id",
      describeRoute({
        summary: "Update agent folder",
        operationId: "moose.agent.folder.update",
        responses: { 200: { description: "Updated folder" }, ...errors(404) },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", MooseAgentDefinition.Folder.partial().omit({ id: true })),
      async (c) => {
        const folder = await MooseAgentDefinition.updateFolder(c.req.valid("param").id, c.req.valid("json"))
        return c.json(folder)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete agent folder",
        operationId: "moose.agent.folder.delete",
        responses: { 200: { description: "Deleted" }, ...errors(404) },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        await MooseAgentDefinition.removeFolder(c.req.valid("param").id)
        return c.json(true)
      },
    ),
)

// ===== Active Folder Route =====
export const MooseAgentActiveFolderRoutes = lazy(() =>
  new Hono()
    .put(
      "/",
      describeRoute({
        summary: "Set active agent folder",
        operationId: "moose.agent.folder.setActive",
        responses: { 200: { description: "Updated config" }, ...errors(404) },
      }),
      validator("json", z.object({ folderId: z.string() })),
      async (c) => {
        const config = await MooseAgentDefinition.setActiveFolder(c.req.valid("json").folderId)
        Agent.invalidateCache()
        return c.json(config)
      },
    ),
)

// ===== Tools Endpoint — returns all tool groups for the scoping UI =====
export const ToolsRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List all available tools grouped by category",
      operationId: "tools.list",
      responses: { 200: { description: "Tool groups" } },
    }),
    async (c) => c.json({ groups: TOOL_GROUPS }),
  ),
)

// ===== Agent Definition Routes =====
export const MooseAgentRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List Moose agent definitions",
        description: "Get all Moose agent definitions from the global config file.",
        operationId: "moose.agent.list",
        responses: {
          200: {
            description: "List of agent definitions",
            content: {
              "application/json": {
                schema: resolver(MooseAgentDefinition.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const definitions = await MooseAgentDefinition.list()
        return c.json(definitions)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get Moose agent definition",
        description: "Get a specific Moose agent definition by ID.",
        operationId: "moose.agent.get",
        responses: {
          200: {
            description: "Agent definition",
            content: {
              "application/json": {
                schema: resolver(MooseAgentDefinition.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const definition = await MooseAgentDefinition.get(c.req.valid("param").id)
        if (!definition) {
          return c.json({ error: "Agent definition not found" }, 404)
        }
        return c.json(definition)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create Moose agent definition",
        description: "Create a new Moose agent definition in the global config file.",
        operationId: "moose.agent.create",
        responses: {
          200: {
            description: "Created agent definition",
            content: {
              "application/json": {
                schema: resolver(MooseAgentDefinition.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", MooseAgentDefinition.Info),
      async (c) => {
        const definition = await MooseAgentDefinition.create(c.req.valid("json"))
        Agent.invalidateCache()
        return c.json(definition)
      },
    )
    .put(
      "/:id",
      describeRoute({
        summary: "Update Moose agent definition",
        description: "Update an existing Moose agent definition.",
        operationId: "moose.agent.update",
        responses: {
          200: {
            description: "Updated agent definition",
            content: {
              "application/json": {
                schema: resolver(MooseAgentDefinition.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator("json", MooseAgentDefinition.Info.partial().omit({ id: true })),
      async (c) => {
        const definition = await MooseAgentDefinition.update(c.req.valid("param").id, c.req.valid("json"))
        Agent.invalidateCache()
        return c.json(definition)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete Moose agent definition",
        description: "Delete a Moose agent definition from the global config file.",
        operationId: "moose.agent.delete",
        responses: {
          200: {
            description: "Successfully deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        await MooseAgentDefinition.remove(c.req.valid("param").id)
        Agent.invalidateCache()
        return c.json(true)
      },
    )
    .patch(
      "/reorder",
      describeRoute({
        summary: "Reorder Moose agent definitions",
        description: "Reorder agent definitions by providing an ordered list of IDs.",
        operationId: "moose.agent.reorder",
        responses: {
          200: {
            description: "Reordered agent definitions",
            content: {
              "application/json": {
                schema: resolver(MooseAgentDefinition.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          ids: z.array(z.string()),
        }),
      ),
      async (c) => {
        const definitions = await MooseAgentDefinition.reorder(c.req.valid("json").ids)
        return c.json(definitions)
      },
    ),
)
