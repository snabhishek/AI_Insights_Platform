import { pgTable, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const domains = pgTable("domains", {
  id: varchar("id", { length: 50 }).primaryKey(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  subDomains: jsonb("sub_domains").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
