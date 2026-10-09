import { pgTable, varchar, timestamp, index, text } from "drizzle-orm/pg-core";
import { projects } from "./connectors";

import { PipelineStepStatus } from "../agents/pipelineNames";

export type AgentJobStatus = PipelineStepStatus | "Queued";

export const agentJobs = pgTable("agent_jobs", {
  id: varchar("id", { length: 50 }).primaryKey(),
  projectId: varchar("project_id", { length: 50 })
    .references(() => projects.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").array().notNull(),
  userPrompt: text("user_prompt"),
  status: varchar("status", { length: 50 }).$type<AgentJobStatus>().notNull().default("Queued"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    projectIdIdx: index("agent_jobs_project_id_idx").on(table.projectId),
  };
});
