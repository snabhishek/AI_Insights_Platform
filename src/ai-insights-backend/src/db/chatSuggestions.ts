import { pgTable, varchar, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const chatSuggestions = pgTable(
  "chat_suggestions",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    suggestion: varchar("suggestion", { length: 500 }).notNull().unique(),
    category: varchar("category", { length: 100 }).notNull().default("General"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    displayOrderIdx: index("chat_suggestions_display_order_idx").on(table.displayOrder),
    isActiveIdx: index("chat_suggestions_is_active_idx").on(table.isActive),
  })
);

export type ChatSuggestion = typeof chatSuggestions.$inferSelect;
export type NewChatSuggestion = typeof chatSuggestions.$inferInsert;
