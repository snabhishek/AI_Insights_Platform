import { ChatSuggestion } from "../db/chatSuggestions";

export interface IChatSuggestionRepository {
  getActiveSuggestions(): Promise<ChatSuggestion[]>;
}
