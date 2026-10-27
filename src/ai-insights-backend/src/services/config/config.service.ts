import * as fs from "fs";
import * as path from "path";
import {
  AIProviderType,
  CurrentAIConfig,
  IConfigService,
  LiteLLMModelSummary,
  ModelDiscoveryResult,
  ProviderConfigPayload,
  ProviderTestResult,
} from "./config.service.interface";

export class ConfigService implements IConfigService {
  private getModelVirtualKeys(): Record<string, string> {
    const raw = process.env.COMPASS_LITELLM_MODEL_KEYS;
    const activeModel = process.env.LITELLM_MODEL || process.env.LITELLM_MODEL_NAME || "";
    const activeKey = process.env.LITELLM_VIRTUAL_KEY || "";
    if (!raw) {
      return activeModel && activeKey ? { [activeModel]: activeKey } : {};
    }
    const keys = JSON.parse(raw) as unknown;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
      throw new Error("Stored LiteLLM model key registry is invalid. Repair the Compass service configuration.");
    }
    const result = Object.fromEntries(
      Object.entries(keys).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0
      )
    );
    if (activeModel && activeKey && !result[activeModel]) {
      result[activeModel] = activeKey;
    }
    return result;
  }

  private persistModelVirtualKeys(modelKeys: Record<string, string>): void {
    const serialized = JSON.stringify(modelKeys);
    process.env.COMPASS_LITELLM_MODEL_KEYS = serialized;
    this.persistToEnvFile({ COMPASS_LITELLM_MODEL_KEYS: serialized });
  }

  private async deleteVirtualKey(proxyUrl: string, masterKey: string, virtualKey: string): Promise<void> {
    const response = await fetch(`${proxyUrl}/key/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keys: [virtualKey] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`LiteLLM could not delete the model virtual key (${response.status}): ${body}`);
    }
  }

  private async generateVirtualKey(
    proxyUrl: string,
    masterKey: string,
    modelName: string,
    keyAlias: string
  ): Promise<string> {
    const response = await fetch(`${proxyUrl}/key/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ models: [modelName], key_alias: keyAlias }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`LiteLLM could not generate a virtual key for '${modelName}' (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { key?: unknown };
    if (typeof data.key !== "string" || !data.key.trim()) {
      throw new Error(`LiteLLM returned no virtual key for '${modelName}'.`);
    }
    return data.key;
  }

  private getProxyUrl(): string {
    return (process.env.LITELLM_PROXY_URL || "http://localhost:22002").replace(/\/+$/, "");
  }

  private getMasterKey(): string {
    return process.env.LITELLM_MASTER_KEY || "sk-1234";
  }

  private maskKey(key: string): string {
    if (!key) return "";
    if (key.length <= 8) return "********";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  private inferProvider(modelName: string): AIProviderType {
    const lower = modelName.toLowerCase();
    if (lower.startsWith("gemini") || lower.includes("google")) return "gemini";
    if (lower.startsWith("azure")) return "azure";
    if (lower.startsWith("claude") || lower.includes("anthropic")) return "anthropic";
    if (lower.startsWith("ollama")) return "ollama";
    if (lower.startsWith("groq")) return "groq";
    if (lower.startsWith("mistral")) return "mistral";
    if (lower.startsWith("gpt") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("openai")) return "openai";
    return "gemini";
  }

  private formatLiteLLMParams(payload: ProviderConfigPayload): {
    modelName: string;
    litellmParams: Record<string, unknown>;
  } {
    const rawModel = payload.model.trim();
    let modelName = payload.customModelName?.trim() || rawModel;
    const apiKey = payload.apiKey?.trim() || "";
    const apiBase = payload.apiBase?.trim();
    const apiVersion = payload.apiVersion?.trim();

    const litellmParams: Record<string, unknown> = {};

    switch (payload.provider) {
      case "gemini": {
        const cleaned = rawModel.replace(/^gemini\//, "");
        modelName = `gemini/${cleaned}`;
        litellmParams.model = `gemini/${cleaned}`;
        litellmParams.api_key = apiKey;
        break;
      }
      case "openai": {
        const cleaned = rawModel.replace(/^openai\//, "");
        modelName = cleaned;
        litellmParams.model = `openai/${cleaned}`;
        litellmParams.api_key = apiKey;
        if (apiBase) litellmParams.api_base = apiBase;
        if (payload.organization) litellmParams.organization = payload.organization.trim();
        break;
      }
      case "azure": {
        const deployment = rawModel.replace(/^azure\//, "");
        modelName = `azure/${deployment}`;
        litellmParams.model = `azure/${deployment}`;
        litellmParams.api_key = apiKey;
        if (apiBase) litellmParams.api_base = apiBase;
        if (apiVersion) litellmParams.api_version = apiVersion;
        break;
      }
      case "anthropic": {
        const cleaned = rawModel.replace(/^anthropic\//, "");
        modelName = cleaned;
        litellmParams.model = `anthropic/${cleaned}`;
        litellmParams.api_key = apiKey;
        break;
      }
      case "ollama": {
        const cleaned = rawModel.replace(/^ollama\//, "");
        modelName = `ollama/${cleaned}`;
        litellmParams.model = `ollama/${cleaned}`;
        litellmParams.api_base = apiBase || "http://localhost:11434";
        break;
      }
      case "groq": {
        const cleaned = rawModel.replace(/^groq\//, "");
        modelName = `groq/${cleaned}`;
        litellmParams.model = `groq/${cleaned}`;
        litellmParams.api_key = apiKey;
        break;
      }
      case "mistral": {
        const cleaned = rawModel.replace(/^mistral\//, "");
        modelName = `mistral/${cleaned}`;
        litellmParams.model = `mistral/${cleaned}`;
        litellmParams.api_key = apiKey;
        break;
      }
      case "openai-compatible": {
        modelName = rawModel;
        litellmParams.model = `openai/${rawModel}`;
        litellmParams.api_key = apiKey || "sk-dummy";
        if (apiBase) litellmParams.api_base = apiBase;
        break;
      }
      default: {
        modelName = rawModel;
        litellmParams.model = rawModel;
        litellmParams.api_key = apiKey;
        break;
      }
    }

    return { modelName, litellmParams };
  }

  public async discoverModels(
    provider: AIProviderType,
    apiKey?: string,
    apiBase?: string,
    apiVersion?: string
  ): Promise<ModelDiscoveryResult> {
    const effectiveKey = (apiKey || "").trim();

    // The user must enter an API key (or host for Ollama) to discover models
    if (provider !== "ollama" && !effectiveKey) {
      return {
        success: false,
        provider,
        models: [],
        source: "provider_endpoint",
        message: "API key is required to discover models for this provider.",
      };
    }

    try {
      if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.models) ? data.models : [])
            .filter((m: any) => {
              const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
              return methods.includes("generateContent") || methods.length === 0;
            })
            .map((m: any) => `gemini/${(m.name || "").replace(/^models\//, "")}`)
            .filter((name: string) => !name.includes("embedding") && !name.includes("aqa"));

          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Google Gemini API returned HTTP ${res.status} (${res.statusText})`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "openai") {
        const base = (apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
        const res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${effectiveKey}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : [])
            .map((m: any) => m.id as string)
            .filter((id: string) => /^(gpt|o1|o3|chatgpt)/i.test(id))
            .sort();
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `OpenAI API returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "azure") {
        if (!apiBase) {
          return { success: false, provider, models: [], source: "provider_endpoint", message: "Azure OpenAI endpoint (API Base) is required." };
        }
        const base = apiBase.replace(/\/+$/, "");
        const ver = apiVersion || "2024-02-01";
        const res = await fetch(`${base}/openai/deployments?api-version=${ver}`, {
          headers: { "api-key": effectiveKey },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : [])
            .map((d: any) => `azure/${d.id || d.model}`);
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Azure OpenAI returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": effectiveKey, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : [])
            .map((m: any) => m.id as string)
            .filter((id: string) => id.startsWith("claude-"));
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Anthropic API returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "ollama") {
        const base = (apiBase || "http://localhost:11434").replace(/\/+$/, "");
        const res = await fetch(`${base}/api/tags`, {
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.models) ? data.models : [])
            .map((m: any) => `ollama/${m.name}`);
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
          return { success: false, provider, models: [], source: "provider_endpoint", message: "No local models found in Ollama. Pull a model first with 'ollama run <model>'." };
        } else {
          return { success: false, provider, models: [], source: "provider_endpoint", message: `Ollama host returned HTTP ${res.status}` };
        }
      } else if (provider === "groq") {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${effectiveKey}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : [])
            .map((m: any) => `groq/${m.id}`);
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Groq API returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "mistral") {
        const res = await fetch("https://api.mistral.ai/v1/models", {
          headers: { Authorization: `Bearer ${effectiveKey}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : [])
            .map((m: any) => `mistral/${m.id}`);
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Mistral API returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      } else if (provider === "openai-compatible") {
        if (!apiBase) {
          return { success: false, provider, models: [], source: "provider_endpoint", message: "API Base URL is required for OpenAI-Compatible providers." };
        }
        const base = apiBase.replace(/\/+$/, "");
        const res = await fetch(`${base}/models`, {
          headers: effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : {},
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (Array.isArray(data.data) ? data.data : []).map((m: any) => m.id as string);
          if (models.length > 0) {
            return { success: true, provider, models: Array.from(new Set(models)), source: "provider_endpoint" };
          }
        } else {
          const errJson: any = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `Endpoint returned HTTP ${res.status}`;
          return { success: false, provider, models: [], source: "provider_endpoint", message: msg };
        }
      }
    } catch (err: any) {
      console.warn(`[ConfigService] Live discovery from ${provider} endpoint failed:`, err?.message || err);
      return {
        success: false,
        provider,
        models: [],
        source: "provider_endpoint",
        message: err?.message ? `Failed to connect: ${err.message}` : "Failed to connect to provider endpoint. Please check your network and API key.",
      };
    }

    return {
      success: false,
      provider,
      models: [],
      source: "provider_endpoint",
      message: "No models found from provider endpoint. Please check your credentials.",
    };
  }

  public async getCurrentConfig(): Promise<CurrentAIConfig> {
    const proxyUrl = this.getProxyUrl();
    const masterKey = this.getMasterKey();
    const envModel = (process.env.LITELLM_MODEL || process.env.LITELLM_MODEL_NAME || "").trim();
    const envVirtualKey = (process.env.LITELLM_VIRTUAL_KEY || process.env.LITELLM_API_KEY || "").trim();

    let configuredModels: LiteLLMModelSummary[] = [];

    // Query LiteLLM DB directly for all registered models
    try {
      const response = await fetch(`${proxyUrl}/model/info`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const json = (await response.json()) as any;
        const rawList = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        configuredModels = rawList.map((item: any) => {
          const modelName = item.model_name || item.id || "Unknown";
          const litellmModel = item.litellm_params?.model || item.model_info?.key || modelName;
          const provider = item.litellm_params?.custom_llm_provider || item.model_info?.litellm_provider || this.inferProvider(modelName);
          return {
            id: item.model_info?.id || item.model_id || item.id || modelName,
            modelName,
            litellmModel,
            provider,
            createdAt: item.model_info?.created_at,
          };
        });
      }
    } catch (err: any) {
      console.warn("[ConfigService] Could not reach LiteLLM /model/info:", err?.message || err);
    }

    // A registered model is not active until Compass has selected it and stored its key.
    const activeModel = configuredModels.find((model) => model.modelName === envModel)?.modelName || "";

    // Virtual key is only applicable if an active model is configured in LiteLLM
    const virtualKey = activeModel ? envVirtualKey : "";
    const activeProvider = activeModel ? this.inferProvider(activeModel) : "";

    return {
      activeProvider,
      activeModel,
      virtualKey,
      virtualKeyMasked: this.maskKey(virtualKey),
      proxyUrl,
      masterKeyConfigured: Boolean(masterKey),
      configuredModels,
      isConfigured: Boolean(virtualKey.trim() && activeModel.trim()),
    };
  }

  public async saveProviderConfig(payload: ProviderConfigPayload): Promise<ProviderTestResult> {
    const proxyUrl = this.getProxyUrl();
    const masterKey = this.getMasterKey();

    if (!payload.provider) {
      return { success: false, message: "AI provider is required", latencyMs: 0 };
    }
    if (!payload.model) {
      return { success: false, message: "Model is required", latencyMs: 0 };
    }
    if (payload.provider !== "ollama" &&
        payload.provider !== "openai-compatible" &&
        !payload.apiKey?.trim()) {
      return {
        success: false,
        message: `An API key is required to register a ${payload.provider} model.`,
        latencyMs: 0,
      };
    }

    const { modelName, litellmParams } = this.formatLiteLLMParams(payload);

    try {
      // 1. Check if model already exists in LiteLLM DB; if so, delete existing record so we re-create cleanly
      const infoRes = await fetch(`${proxyUrl}/model/info`, {
        method: "GET",
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      const modelKeys = this.getModelVirtualKeys();
      if (infoRes && infoRes.ok) {
        const infoData = (await infoRes.json()) as any;
        const list = Array.isArray(infoData?.data) ? infoData.data : [];
        const existing = list.find((m: any) => m.model_name === modelName);
        const previousVirtualKey =
          modelKeys[modelName] ||
          ((process.env.LITELLM_MODEL || process.env.LITELLM_MODEL_NAME) === modelName
            ? process.env.LITELLM_VIRTUAL_KEY
            : "");
        if (existing && !(existing.model_info?.id || existing.model_id || existing.id)) {
          throw new Error(`LiteLLM model '${modelName}' has no model ID and cannot be safely replaced.`);
        }
        if (existing && previousVirtualKey) {
          await this.deleteVirtualKey(proxyUrl, masterKey, previousVirtualKey);
        }
        if (existing) {
          const delId = existing.model_info?.id || existing.model_id || existing.id;
          const deleteRes = await fetch(`${proxyUrl}/model/delete`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${masterKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: delId }),
          });
          if (!deleteRes.ok) {
            const errText = await deleteRes.text().catch(() => "");
            if (previousVirtualKey) {
              try {
                const restoredKey = await this.generateVirtualKey(
                  proxyUrl,
                  masterKey,
                  modelName,
                  `compass_restore_${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}`
                );
                modelKeys[modelName] = restoredKey;
                this.persistModelVirtualKeys(modelKeys);
                if ((process.env.LITELLM_MODEL || process.env.LITELLM_MODEL_NAME) === modelName) {
                  process.env.LITELLM_VIRTUAL_KEY = restoredKey;
                  this.persistToEnvFile({ LITELLM_VIRTUAL_KEY: restoredKey });
                }
              } catch (restoreError: any) {
                throw new Error(
                  `Could not replace existing LiteLLM model (${deleteRes.status}): ${errText}. The previous virtual key was deleted but could not be restored: ${restoreError?.message || restoreError}`
                );
              }
            }
            throw new Error(`Could not replace existing LiteLLM model (${deleteRes.status}): ${errText}`);
          }
          delete modelKeys[modelName];
          this.persistModelVirtualKeys(modelKeys);
        }
      }

      // 2. Register model in LiteLLM DB
      const createRes = await fetch(`${proxyUrl}/model/new`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: modelName,
          litellm_params: litellmParams,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        return {
          success: false,
          message: `Failed to configure model in LiteLLM DB (${createRes.status}): ${errText}`,
          latencyMs: 0,
          model: modelName,
        };
      }

      const createdModel = (await createRes.json().catch(() => ({}))) as any;
      const createdModelId =
        createdModel?.model_info?.id || createdModel?.model_id || createdModel?.id;

      // 3. Generate Virtual Key from LiteLLM DB for this model
      const keyRes = await fetch(`${proxyUrl}/key/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          models: [modelName],
          key_alias: `compass_${payload.provider}_${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!keyRes.ok) {
        const errText = await keyRes.text().catch(() => "");
        if (createdModelId) {
          const cleanupRes = await fetch(`${proxyUrl}/model/delete`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${masterKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: createdModelId }),
            signal: AbortSignal.timeout(8000),
          });
          if (!cleanupRes.ok) {
            const cleanupError = await cleanupRes.text().catch(() => "");
            return {
              success: false,
              message: `LiteLLM could not generate a virtual key (${keyRes.status}): ${errText}. The new model could not be rolled back (${cleanupRes.status}): ${cleanupError}`,
              latencyMs: 0,
              model: modelName,
            };
          }
        }
        return {
          success: false,
          message: createdModelId
            ? `LiteLLM could not generate a virtual key: ${errText}. The new model was rolled back.`
            : `LiteLLM could not generate a virtual key: ${errText}. The model may remain registered because LiteLLM returned no model ID for rollback.`,
          latencyMs: 0,
          model: modelName,
        };
      }

      const keyData = (await keyRes.json()) as any;
      const virtualKey = keyData?.key;

      if (!virtualKey) {
        if (createdModelId) {
          const cleanupRes = await fetch(`${proxyUrl}/model/delete`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${masterKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: createdModelId }),
            signal: AbortSignal.timeout(8000),
          });
          if (!cleanupRes.ok) {
            const cleanupError = await cleanupRes.text().catch(() => "");
            return {
              success: false,
              message: `LiteLLM returned no virtual key, and the model could not be rolled back (${cleanupRes.status}): ${cleanupError}`,
              latencyMs: 0,
              model: modelName,
            };
          }
        }
        return {
          success: false,
          message: createdModelId
            ? "LiteLLM returned no virtual key. The new model was rolled back."
            : "LiteLLM returned no virtual key, and the model may remain registered because LiteLLM returned no model ID for rollback.",
          latencyMs: 0,
          model: modelName,
        };
      }

      // 4. Update backend runtime environment
      process.env.LITELLM_MODEL = modelName;
      process.env.LITELLM_MODEL_NAME = modelName;
      process.env.LITELLM_VIRTUAL_KEY = virtualKey;
      process.env.AI_PROVIDER = "litellm";

      modelKeys[modelName] = virtualKey;
      process.env.COMPASS_LITELLM_MODEL_KEYS = JSON.stringify(modelKeys);
      // 5. Persist to the durable runtime environment file.
      this.persistToEnvFile({
        LITELLM_MODEL: modelName,
        LITELLM_MODEL_NAME: modelName,
        LITELLM_VIRTUAL_KEY: virtualKey,
        COMPASS_LITELLM_MODEL_KEYS: process.env.COMPASS_LITELLM_MODEL_KEYS,
        AI_PROVIDER: "litellm",
      });

      // 6. Test a quick chat completion probe through LiteLLM with the new key
      const start = Date.now();
      const testProbeRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${virtualKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(12000),
      }).catch((e) => ({ ok: false, status: 0, text: async () => e?.message || "Timeout" } as any));

      const latencyMs = Date.now() - start;

      if (!testProbeRes.ok) {
        const probeErr = await testProbeRes.text().catch(() => "");
        return {
          success: true,
          message: `Configured in LiteLLM DB! Virtual key generated. (Note: Upstream model test: ${probeErr.slice(0, 150) || "pending first query"})`,
          latencyMs,
          model: modelName,
          virtualKey,
        };
      }

      return {
        success: true,
        message: `Successfully configured ${payload.provider} in LiteLLM DB! Virtual key generated and model responded in ${latencyMs}ms.`,
        latencyMs,
        model: modelName,
        virtualKey,
      };
    } catch (err: any) {
      console.error("[ConfigService] saveProviderConfig failed:", err);
      return {
        success: false,
        message: `Error configuring provider in LiteLLM DB: ${err?.message || err}`,
        latencyMs: 0,
        model: modelName,
      };
    }
  }

  public async testProviderConfig(payload: ProviderConfigPayload): Promise<ProviderTestResult> {
    const proxyUrl = this.getProxyUrl();
    const masterKey = this.getMasterKey();

    if (!payload.provider) {
      return { success: false, message: "AI provider is required", latencyMs: 0 };
    }
    if (!payload.model) {
      return { success: false, message: "Model is required", latencyMs: 0 };
    }

    const { modelName, litellmParams } = this.formatLiteLLMParams(payload);

    // If no new API key is provided, test the existing active model directly
    if (!payload.apiKey?.trim()) {
      const start = Date.now();
      try {
        const testRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${masterKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: "Ping" }],
            max_tokens: 5,
          }),
          signal: AbortSignal.timeout(8000),
        });

        const latencyMs = Date.now() - start;
        if (testRes.ok) {
          return {
            success: true,
            message: `Active model "${modelName}" is responding through LiteLLM (${latencyMs}ms).`,
            latencyMs,
            model: modelName,
          };
        }
        const err = await testRes.text().catch(() => "");
        return {
          success: false,
          message: `Model test returned ${testRes.status}: ${err.slice(0, 180)}`,
          latencyMs,
          model: modelName,
        };
      } catch (e: any) {
        return {
          success: false,
          message: `Model test error: ${e?.message || e}`,
          latencyMs: Date.now() - start,
          model: modelName,
        };
      }
    }

    const testTempModelName = `test_${Date.now()}_${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    const startTime = Date.now();
    let tempModelCreated = false;
    let tempModelId = "";

    try {
      // 1. Temporarily add model to LiteLLM DB to verify credentials
      const addRes = await fetch(`${proxyUrl}/model/new`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: testTempModelName,
          litellm_params: litellmParams,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!addRes.ok) {
        const errText = await addRes.text().catch(() => "");
        return {
          success: false,
          message: `LiteLLM failed to register provider: ${errText}`,
          latencyMs: Date.now() - startTime,
          model: modelName,
        };
      }

      const addData = (await addRes.json()) as any;
      tempModelCreated = true;
      tempModelId = addData?.model_id || addData?.model_info?.id || "";

      // 2. Perform test completion via LiteLLM
      const completionRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: testTempModelName,
          messages: [{ role: "user", content: "Respond with the word 'OK'." }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(12000),
      });

      const latencyMs = Date.now() - startTime;

      if (!completionRes.ok) {
        const errText = await completionRes.text().catch(() => "");
        return {
          success: false,
          message: `Provider credential verification failed (${completionRes.status}): ${errText}`,
          latencyMs,
          model: modelName,
        };
      }

      return {
        success: true,
        message: `Connection to ${payload.provider} verified via LiteLLM (${latencyMs}ms)!`,
        latencyMs,
        model: modelName,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Connection test error: ${err?.message || err}`,
        latencyMs: Date.now() - startTime,
        model: modelName,
      };
    } finally {
      // Clean up temporary model
      if (tempModelCreated && tempModelId) {
        fetch(`${proxyUrl}/model/delete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${masterKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: tempModelId }),
        }).catch(() => null);
      }
    }
  }

  public async deleteModelFromLiteLLM(modelId: string): Promise<{ success: boolean; message: string }> {
    const proxyUrl = this.getProxyUrl();
    const masterKey = this.getMasterKey();

    try {
      const infoRes = await fetch(`${proxyUrl}/model/info`, {
        method: "GET",
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!infoRes.ok) {
        const errText = await infoRes.text().catch(() => "");
        return { success: false, message: `Could not find the model virtual key (${infoRes.status}): ${errText}` };
      }
      const infoData = (await infoRes.json()) as any;
      const models = Array.isArray(infoData?.data) ? infoData.data : [];
      const model = models.find((item: any) =>
        [item?.model_info?.id, item?.model_id, item?.id].some((id) => id === modelId)
      );
      if (!model) {
        return { success: false, message: `Model '${modelId}' was not found in LiteLLM.` };
      }
      const modelName = model.model_name;
      const modelKeys = this.getModelVirtualKeys();
      const activeModel = process.env.LITELLM_MODEL || process.env.LITELLM_MODEL_NAME || "";
      const virtualKey = modelKeys[modelName] ||
        (activeModel === modelName ? process.env.LITELLM_VIRTUAL_KEY : "");

      if (virtualKey) {
        await this.deleteVirtualKey(proxyUrl, masterKey, virtualKey);
      }

      const res = await fetch(`${proxyUrl}/model/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: modelId }),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (virtualKey) {
          try {
            const restoredKey = await this.generateVirtualKey(
              proxyUrl,
              masterKey,
              modelName,
              `compass_restore_${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}`
            );
            modelKeys[modelName] = restoredKey;
            this.persistModelVirtualKeys(modelKeys);
            if (activeModel === modelName) {
              process.env.LITELLM_VIRTUAL_KEY = restoredKey;
              this.persistToEnvFile({ LITELLM_VIRTUAL_KEY: restoredKey });
            }
          } catch (restoreError: any) {
            return {
              success: false,
              message: `Model deletion failed (${errText}); its virtual key was deleted but could not be restored: ${restoreError?.message || restoreError}`,
            };
          }
        }
        return { success: false, message: `Failed to delete model: ${errText}` };
      }

      delete modelKeys[modelName];
      this.persistModelVirtualKeys(modelKeys);
      if (activeModel === modelName) {
        process.env.LITELLM_MODEL = "";
        process.env.LITELLM_MODEL_NAME = "";
        process.env.LITELLM_VIRTUAL_KEY = "";
        this.persistToEnvFile({
          LITELLM_MODEL: "",
          LITELLM_MODEL_NAME: "",
          LITELLM_VIRTUAL_KEY: "",
        });
      }

      return {
        success: true,
        message: virtualKey
          ? `Model '${modelName}' and its LiteLLM virtual key were deleted successfully.`
          : `Model '${modelName}' deleted. No Compass-managed virtual key was recorded for it.`,
      };
    } catch (err: any) {
      return { success: false, message: err?.message || "Failed to contact LiteLLM" };
    }
  }

  public async setActiveModel(modelName: string): Promise<{ success: boolean; message: string; activeModel?: string; virtualKey?: string }> {
    const proxyUrl = this.getProxyUrl();
    const masterKey = this.getMasterKey();

    if (!modelName || !modelName.trim()) {
      return { success: false, message: "Model name is required" };
    }

    const trimmedModel = modelName.trim();

    try {
      // 1. Verify model exists in LiteLLM DB
      const infoRes = await fetch(`${proxyUrl}/model/info`, {
        method: "GET",
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(5000),
      });

      if (!infoRes.ok) {
        return { success: false, message: `Failed to query LiteLLM DB: HTTP ${infoRes.status}` };
      }

      const infoData = (await infoRes.json()) as any;
      const dataList = Array.isArray(infoData?.data) ? infoData.data : [];
      const modelExists = dataList.some((item: any) => item?.model_name === trimmedModel);

      if (!modelExists) {
        return { success: false, message: `Model '${trimmedModel}' was not found in LiteLLM DB.` };
      }

      const modelKeys = this.getModelVirtualKeys();
      let virtualKey = modelKeys[trimmedModel];
      // 2. Generate an authorized virtual key if this model has not been assigned one.
      if (!virtualKey) {
      const keyRes = await fetch(`${proxyUrl}/key/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          models: [trimmedModel],
          key_alias: `compass_active_${trimmedModel.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!keyRes.ok) {
        const errText = await keyRes.text().catch(() => "");
        return {
          success: false,
          message: `Model '${trimmedModel}' exists, but LiteLLM could not generate its virtual key (${keyRes.status}): ${errText}`,
        };
      }
      const keyData = (await keyRes.json()) as any;
      virtualKey = keyData?.key;
      if (typeof virtualKey !== "string" || !virtualKey.trim()) {
        return {
          success: false,
          message: `Model '${trimmedModel}' exists, but LiteLLM returned no virtual key.`,
        };
      }
      modelKeys[trimmedModel] = virtualKey;
      this.persistModelVirtualKeys(modelKeys);
      }

      // 3. Update backend runtime environment
      process.env.LITELLM_MODEL = trimmedModel;
      process.env.LITELLM_MODEL_NAME = trimmedModel;
      process.env.LITELLM_VIRTUAL_KEY = virtualKey;
      process.env.AI_PROVIDER = "litellm";

      // 4. Persist to .env
      const updates: Record<string, string> = {
        LITELLM_MODEL: trimmedModel,
        LITELLM_MODEL_NAME: trimmedModel,
        LITELLM_VIRTUAL_KEY: virtualKey,
        COMPASS_LITELLM_MODEL_KEYS: JSON.stringify(modelKeys),
        AI_PROVIDER: "litellm",
      };
      this.persistToEnvFile(updates);

      return {
        success: true,
        message: `Model '${trimmedModel}' is now set as the active platform model.`,
        activeModel: trimmedModel,
        virtualKey,
      };
    } catch (err: any) {
      console.error("[ConfigService] Error setting active model:", err);
      return { success: false, message: err?.message || "Failed to set active model in LiteLLM" };
    }
  }

  private persistToEnvFile(entries: Record<string, string>) {
    const envPath = process.env.COMPASS_RUNTIME_ENV_FILE
      ? path.resolve(process.env.COMPASS_RUNTIME_ENV_FILE)
      : path.resolve(process.cwd(), ".env");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    for (const [key, value] of Object.entries(entries)) {
      if (/[\r\n]/.test(value)) {
        throw new Error(`Cannot persist ${key}: values cannot contain line breaks.`);
      }
      const expression = new RegExp(`^${key}=.*$`, "m");
      const line = `${key}=${value}`;
      if (expression.test(content)) {
        content = content.replace(expression, line);
      } else {
        content += `${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
      }
    }

    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, content, "utf-8");
  }
}
