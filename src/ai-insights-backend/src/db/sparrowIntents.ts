import { boolean, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const sparrowIntents = pgTable("sparrow_intents", {
  code: varchar("code", { length: 80 }).primaryKey(),
  description: text("description").notNull(),
  allowsInference: boolean("allows_inference").notNull().default(false),
  conversational: boolean("conversational").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
