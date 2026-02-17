import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MooseAgentInstance } from "../../agent/moose/instance"
import { MooseAgentDefinition } from "../../agent/moose/definition"
import { MooseAgentCommunication } from "../../agent/moose/communication"
import { Session } from "../../session"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const AgentInstanceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List agent instances",
        description: "Get all agent instances for a workspace session.",
        operationId: "moose.instance.list",
        responses: {
          200: {
            description: "List of agent instances",
            content: {
              "application/json": {
                schema: resolver(MooseAgentInstance.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          workspaceSessionID: z.string().meta({ description: "Workspace session ID to filter instances" }),
        }),
      ),
      async (c) => {
        const { workspaceSessionID } = c.req.valid("query")
        const instances = MooseAgentInstance.listByWorkspace(workspaceSessionID)
        return c.json(instances)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get agent instance",
        description: "Get a specific agent instance by ID.",
        operationId: "moose.instance.get",
        responses: {
          200: {
            description: "Agent instance",
            content: {
              "application/json": {
                schema: resolver(MooseAgentInstance.Info),
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
        const instance = await MooseAgentInstance.get(c.req.valid("param").id)
        return c.json(instance)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create agent instance",
        description: "Create a new agent instance on the canvas.",
        operationId: "moose.instance.create",
        responses: {
          200: {
            description: "Created agent instance",
            content: {
              "application/json": {
                schema: resolver(MooseAgentInstance.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          workspaceSessionID: z.string(),
          agentDefinitionID: z.string(),
          sessionID: z.string().optional(),
          parentInstanceID: z.string().optional(),
          positionX: z.number().default(0),
          positionY: z.number().default(0),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")

        // Create a session for this agent instance if one wasn't provided
        let sessionID = input.sessionID
        if (!sessionID) {
          const definition = await MooseAgentDefinition.get(input.agentDefinitionID)
          const title = definition ? `Agent: ${definition.name}` : `Agent: ${input.agentDefinitionID}`
          const session = await Session.create({ title })
          sessionID = session.id
        }

        const instance = await MooseAgentInstance.create({
          ...input,
          sessionID,
        })
        return c.json(instance)
      },
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Update agent instance",
        description: "Update an agent instance (position, state).",
        operationId: "moose.instance.update",
        responses: {
          200: {
            description: "Updated successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
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
      validator(
        "json",
        z.object({
          positionX: z.number().optional(),
          positionY: z.number().optional(),
          state: MooseAgentInstance.State.optional(),
          errorMessage: z.string().optional(),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const updates = c.req.valid("json")

        if (updates.positionX !== undefined && updates.positionY !== undefined) {
          await MooseAgentInstance.move({
            instanceID: id,
            x: updates.positionX,
            y: updates.positionY,
          })
        }

        if (updates.state !== undefined) {
          await MooseAgentInstance.setState({
            instanceID: id,
            state: updates.state,
            errorMessage: updates.errorMessage,
          })
        }

        return c.json(true)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete agent instance",
        description: "Remove an agent instance from the canvas and its associated session.",
        operationId: "moose.instance.delete",
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
        await MooseAgentInstance.remove(c.req.valid("param").id)
        return c.json(true)
      },
    )
    .post(
      "/:id/spawn",
      describeRoute({
        summary: "Spawn child agent",
        description:
          "Create a child agent instance from a parent, validating the spawnable list and enforcing spawn limits.",
        operationId: "moose.instance.spawn",
        responses: {
          200: {
            description: "Spawned child instance",
            content: {
              "application/json": {
                schema: resolver(MooseAgentInstance.Info),
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
      validator(
        "json",
        z.object({
          childDefinitionID: z.string(),
          workspaceSessionID: z.string(),
          positionX: z.number().optional(),
          positionY: z.number().optional(),
        }),
      ),
      async (c) => {
        const parentID = c.req.valid("param").id
        const input = c.req.valid("json")
        const child = await MooseAgentInstance.spawn({
          parentInstanceID: parentID,
          ...input,
        })
        return c.json(child)
      },
    )
    .post(
      "/:id/message",
      describeRoute({
        summary: "Send inter-agent message",
        description:
          "Send a message between parent and child agent instances. Validates relationship and direction-appropriate message types.",
        operationId: "moose.instance.message",
        responses: {
          200: {
            description: "Message sent successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
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
      validator(
        "json",
        z.object({
          toInstanceID: z.string(),
          type: MooseAgentCommunication.MessageType,
          content: z.string(),
        }),
      ),
      async (c) => {
        const fromID = c.req.valid("param").id
        const input = c.req.valid("json")
        await MooseAgentCommunication.send({
          fromInstanceID: fromID,
          ...input,
        })
        return c.json(true)
      },
    ),
)
