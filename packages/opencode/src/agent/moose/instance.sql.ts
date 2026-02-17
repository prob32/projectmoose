import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const AgentInstanceTable = sqliteTable(
  "agent_instance",
  {
    id: text().primaryKey(),
    workspace_session_id: text().notNull(),
    agent_definition_id: text().notNull(),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    parent_instance_id: text(),
    position_x: integer().notNull().default(0),
    position_y: integer().notNull().default(0),
    state: text().notNull().default("idle"),
    error_message: text(),
    display_name: text(),
    time_last_active: integer(),
    ...Timestamps,
  },
  (table) => [
    index("agent_instance_workspace_idx").on(table.workspace_session_id),
    index("agent_instance_parent_idx").on(table.parent_instance_id),
    index("agent_instance_session_idx").on(table.session_id),
  ],
)
