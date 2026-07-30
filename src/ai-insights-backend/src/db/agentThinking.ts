import { pgTable, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { projects } from "./connectors";

export interface ThinkingLog {
  time: string;
  text: string;
  done: boolean;
}

export const agentThinking = pgTable("agent_thinking", {
  id: varchar("id", { length: 50 }).primaryKey(),
  projectId: varchar("project_id", { length: 50 })
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  pipeline: varchar("pipeline", { length: 100 }).notNull(),
  substep: varchar("substep", { length: 100 }).notNull(),
  thinking: jsonb("thinking").$type<ThinkingLog[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    projectIdIdx: index("agent_thinking_project_id_idx").on(table.projectId),
    projectPipelineSubstepIdx: index("agent_thinking_proj_pipe_sub_idx").on(table.projectId, table.pipeline, table.substep),
  };
});
