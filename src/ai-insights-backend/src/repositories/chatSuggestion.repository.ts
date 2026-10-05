import { eq, asc } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { IChatSuggestionRepository } from "./chatSuggestion.repository.interface";
import * as schema from "../db/chatSuggestions";
import { ChatSuggestion } from "../db/chatSuggestions";

export class PostgresChatSuggestionRepository implements IChatSuggestionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getActiveSuggestions(): Promise<ChatSuggestion[]> {
    const results = await this.db
      .select()
      .from(schema.chatSuggestions)
      .where(eq(schema.chatSuggestions.isActive, true))
      .orderBy(asc(schema.chatSuggestions.displayOrder));

    return results;
  }
}
