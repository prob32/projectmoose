import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MooseAgentDefinition } from "../../agent/moose/definition"
import { Agent } from "../../agent/agent"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
