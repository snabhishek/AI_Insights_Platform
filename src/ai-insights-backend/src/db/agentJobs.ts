import { pgTable, varchar, timestamp, index, text } from "drizzle-orm/pg-core";
import { projects } from "./connectors";

export const agentJobs = pgTable("agent_jobs", {
  id: varchar("id", { length: 50 }).primaryKey(),
  projectId: varchar("project_id", { length: 50 })
    .references(() => projects.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").array().notNull(),
  userPrompt: text("user_prompt"),
  status: varchar("status", { length: 50 }).notNull().default("queued"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    projectIdIdx: index("agent_jobs_project_id_idx").on(table.projectId),
  };
});
