import { BACKEND_URL } from "../components/providers/AppContext";

export interface ChatSuggestionRecord {
  id: string;
  suggestion: string;
  category: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchChatSuggestions(): Promise<string[]> {
  const res = await fetch(`${BACKEND_URL}/chat-suggestions`);
  if (!res.ok) {
    throw new Error(`Failed to fetch chat suggestions: ${res.statusText}`);
  }
  const json = await res.json();
  const records: ChatSuggestionRecord[] = json.data || (Array.isArray(json) ? json : []);
  return records
    .filter((r) => r.isActive !== false && r.suggestion)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((r) => r.suggestion);
}
