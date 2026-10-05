import { IChatSuggestionService } from "./chatSuggestion.service.interface";
import { IChatSuggestionRepository } from "../../repositories/chatSuggestion.repository.interface";
import { ChatSuggestion } from "../../db/chatSuggestions";

export class ChatSuggestionService implements IChatSuggestionService {
  constructor(private readonly chatSuggestionRepository: IChatSuggestionRepository) {}

  async getSuggestions(): Promise<ChatSuggestion[]> {
    return this.chatSuggestionRepository.getActiveSuggestions();
  }
}
