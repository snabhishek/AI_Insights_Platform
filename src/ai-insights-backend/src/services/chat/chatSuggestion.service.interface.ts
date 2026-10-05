import { ChatSuggestion } from "../../db/chatSuggestions";

export interface IChatSuggestionService {
  getSuggestions(): Promise<ChatSuggestion[]>;
}
