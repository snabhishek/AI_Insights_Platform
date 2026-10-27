export type AIProviderType =
  | "gemini"
  | "openai"
  | "azure"
  | "anthropic"
  | "ollama"
  | "groq"
  | "mistral"
  | "openai-compatible";

export interface ProviderConfigPayload {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  apiBase?: string;
  apiVersion?: string;
  organization?: string;
  customModelName?: string;
}

export interface LiteLLMModelSummary {
  id: string;
  modelName: string;
  litellmModel: string;
  provider: string;
  createdAt?: string;
}

export interface CurrentAIConfig {
  activeProvider: AIProviderType | "";
  activeModel: string;
  virtualKey: string;
  virtualKeyMasked: string;
  proxyUrl: string;
  masterKeyConfigured: boolean;
  configuredModels: LiteLLMModelSummary[];
  isConfigured: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  model?: string;
  virtualKey?: string;
}

export interface ModelDiscoveryResult {
  success: boolean;
  provider: AIProviderType;
  models: string[];
  source: "provider_endpoint";
  message?: string;
}

export interface IConfigService {
  getCurrentConfig(): Promise<CurrentAIConfig>;
  discoverModels(provider: AIProviderType, apiKey?: string, apiBase?: string, apiVersion?: string): Promise<ModelDiscoveryResult>;
  saveProviderConfig(payload: ProviderConfigPayload): Promise<ProviderTestResult>;
  testProviderConfig(payload: ProviderConfigPayload): Promise<ProviderTestResult>;
  deleteModelFromLiteLLM(modelId: string): Promise<{ success: boolean; message: string }>;
  setActiveModel(modelName: string): Promise<{ success: boolean; message: string; activeModel?: string; virtualKey?: string }>;
}
