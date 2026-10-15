import { pgTable, varchar, timestamp, jsonb, bigserial, primaryKey, foreignKey, index } from "drizzle-orm/pg-core";
import { projects } from "./connectors";

export const sparrowChatSessions = pgTable("sparrow_chat_sessions", {
  projectId: varchar("project_id", { length: 50 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  id: varchar("id", { length: 100 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.projectId, table.id] })]);

export const sparrowChatMessages = pgTable("sparrow_chat_messages", {
  projectId: varchar("project_id", { length: 50 }).notNull(),
  conversationId: varchar("conversation_id", { length: 100 }).notNull(),
  id: varchar("id", { length: 100 }).notNull(),
  requestId: varchar("request_id", { length: 100 }).notNull(),
  position: bigserial("position", { mode: "number" }).notNull(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.projectId, table.conversationId, table.id] }),
  foreignKey({ columns: [table.projectId, table.conversationId], foreignColumns: [sparrowChatSessions.projectId, sparrowChatSessions.id] }).onDelete("cascade"),
  index("sparrow_chat_messages_order_idx").on(table.projectId, table.conversationId, table.position)]);
