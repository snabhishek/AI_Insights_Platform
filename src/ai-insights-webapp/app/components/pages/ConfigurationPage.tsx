"use client";

import React, { useState, useEffect, useCallback } from "react";
import { BACKEND_URL, useApp } from "../providers/AppContext";
import {
  Key,
  ShieldCheck,
  Server,
  Cpu,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  Sliders,
  HelpCircle,
  AlertCircle,
  Trash2,
  Database,
  Sparkles,
  Zap,
  Globe,
  Terminal,
  Cloud,
  Search
} from "lucide-react";

export type AIProviderType =
  | "gemini"
  | "openai"
  | "azure"
  | "anthropic"
  | "ollama"
  | "groq"
  | "mistral"
  | "openai-compatible";

interface ProviderOption {
  id: AIProviderType;
  name: string;
  badge: string;
  description: string;
  icon: React.ReactNode;
  fields: {
    apiKey?: boolean;
    apiKeyLabel?: string;
    apiKeyPlaceholder?: string;
    apiBase?: boolean;
    apiBaseLabel?: string;
    apiBasePlaceholder?: string;
    apiVersion?: boolean;
    organization?: boolean;
  };
}

// Zero hardcoded models: All models are discovered live from the provider endpoint or LiteLLM's container catalog
const PROVIDERS: ProviderOption[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "Recommended",
    description: "Google AI Studio or Vertex AI Gemini models",
    icon: <Sparkles className="w-5 h-5 text-blue-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "Google Gemini API Key",
      apiKeyPlaceholder: "AIzaSy...",
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "Direct",
    description: "Official OpenAI GPT models and reasoning engines",
    icon: <Cpu className="w-5 h-5 text-emerald-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "OpenAI API Key",
      apiKeyPlaceholder: "sk-proj-...",
      apiBase: true,
      apiBaseLabel: "Custom API Base (Optional)",
      apiBasePlaceholder: "https://api.openai.com/v1",
      organization: true,
    },
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    badge: "Enterprise",
    description: "Enterprise deployed OpenAI models on Microsoft Azure",
    icon: <Cloud className="w-5 h-5 text-cyan-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "Azure OpenAI API Key",
      apiKeyPlaceholder: "Enter Azure key...",
      apiBase: true,
      apiBaseLabel: "Azure Endpoint / Resource URL",
      apiBasePlaceholder: "https://your-resource.openai.azure.com",
      apiVersion: true,
    },
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    badge: "Claude 3.5",
    description: "Connect Anthropic Claude models for deep reasoning",
    icon: <Sparkles className="w-5 h-5 text-amber-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "Anthropic API Key",
      apiKeyPlaceholder: "sk-ant-...",
    },
  },
  {
    id: "ollama",
    name: "Ollama (Local LLM)",
    badge: "Self-Hosted",
    description: "Run local open-weight models without external cloud keys",
    icon: <Terminal className="w-5 h-5 text-indigo-400" />,
    fields: {
      apiBase: true,
      apiBaseLabel: "Ollama Host URL",
      apiBasePlaceholder: "http://localhost:11434",
    },
  },
  {
    id: "groq",
    name: "Groq",
    badge: "Ultra Fast",
    description: "High-speed inference on Groq LPU hardware",
    icon: <Zap className="w-5 h-5 text-orange-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "Groq API Key",
      apiKeyPlaceholder: "gsk_...",
    },
  },
  {
    id: "mistral",
    name: "Mistral AI",
    badge: "European LLM",
    description: "Connect Mistral Large and Small models via Mistral API",
    icon: <Server className="w-5 h-5 text-red-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "Mistral API Key",
      apiKeyPlaceholder: "Enter Mistral key...",
    },
  },
  {
    id: "openai-compatible",
    name: "OpenAI-Compatible",
    badge: "Custom",
    description: "Any OpenAI-compatible gateway (vLLM, LocalAI, LM Studio)",
    icon: <Globe className="w-5 h-5 text-purple-400" />,
    fields: {
      apiKey: true,
      apiKeyLabel: "API Key (or dummy token)",
      apiKeyPlaceholder: "sk-...",
      apiBase: true,
      apiBaseLabel: "API Base URL",
      apiBasePlaceholder: "http://localhost:8000/v1",
    },
  },
];

interface LiteLLMModelSummary {
  id: string;
  modelName: string;
  litellmModel: string;
  provider: string;
  createdAt?: string;
}

interface CurrentAIConfig {
  activeProvider: AIProviderType | "";
  activeModel: string;
  virtualKey: string;
  virtualKeyMasked: string;
  proxyUrl: string;
  masterKeyConfigured: boolean;
  configuredModels: LiteLLMModelSummary[];
  isConfigured: boolean;
}

export default function ConfigurationPage() {
  const { showToast, showConfirm } = useApp();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Active configuration from backend
  const [currentConfig, setCurrentConfig] = useState<CurrentAIConfig | null>(null);

  // User Selection & Form State
  const [selectedProvider, setSelectedProvider] = useState<AIProviderType>("gemini");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [apiBase, setApiBase] = useState<string>("");
  const [apiVersion, setApiVersion] = useState<string>("2024-02-01");
  const [organization, setOrganization] = useState<string>("");

  // Dynamic Model Discovery State
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Test Results State
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    success: boolean;
    message: string;
    latencyMs?: number;
  }>({
    tested: false,
    success: false,
    message: "",
  });

  const activeProviderDef = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  // Dynamic Model Discovery via Backend Proxy
  const performModelDiscovery = useCallback(async (
    provider: AIProviderType,
    key?: string,
    base?: string,
    ver?: string
  ) => {
    const activeKey = (key !== undefined ? key : apiKey).trim();
    const activeBase = (base !== undefined ? base : apiBase).trim();
    const activeVer = (ver !== undefined ? ver : apiVersion).trim();

    // The user must enter an API key (or host for Ollama) to view models
    if (provider !== "ollama" && !activeKey) {
      setDiscoveredModels([]);
      setDiscoveryError(null);
      return;
    }

    try {
      setDiscovering(true);
      setDiscoveryError(null);
      const res = await fetch(`${BACKEND_URL}/config/discover-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: activeKey,
          apiBase: activeBase,
          apiVersion: activeVer,
        }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        const models: string[] = json.data.models || [];
        setDiscoveredModels(models);
        setDiscoveryError(null);

        // Auto-select first model if none or invalid
        if (models.length > 0) {
          setSelectedModel((prev) => (models.includes(prev) ? prev : models[0]));
        } else {
          setSelectedModel("custom");
        }
      } else {
        setDiscoveredModels([]);
        setDiscoveryError(json.error || json.message || "Failed to discover models from provider. Please verify your credentials.");
      }
    } catch (err: any) {
      console.warn("Model discovery error:", err);
      setDiscoveredModels([]);
      setDiscoveryError(err?.message || "Failed to connect to backend proxy for model discovery.");
    } finally {
      setDiscovering(false);
    }
  }, [apiKey, apiBase, apiVersion]);

  // Debounce API key changes to trigger live discovery from provider
  useEffect(() => {
    if (selectedProvider === "ollama") return;
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length >= 8) {
      const timer = setTimeout(() => {
        performModelDiscovery(selectedProvider, trimmedKey, apiBase, apiVersion);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setDiscoveredModels([]);
      setDiscoveryError(null);
    }
  }, [apiKey, selectedProvider, apiBase, apiVersion, performModelDiscovery]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/config`);
      const json = await res.json();
      if (json.success && json.data) {
        const data: CurrentAIConfig = json.data;
        setCurrentConfig(data);

        const initialProvider = data.activeProvider || "gemini";
        setSelectedProvider(initialProvider);
        if (data.activeModel) {
          setSelectedModel(data.activeModel);
        }

        // Only run discovery if Ollama (no key needed)
        if (initialProvider === "ollama") {
          await performModelDiscovery(initialProvider, "", apiBase, apiVersion);
        }
      }
    } catch (err: any) {
      console.warn("Could not load current AI configuration:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleProviderSelect = (providerId: AIProviderType) => {
    setConfigurationError(null);
    setSelectedProvider(providerId);
    setTestResult({ tested: false, success: false, message: "" });
    setSelectedModel("");
    setCustomModel("");
    setDiscoveredModels([]);
    setDiscoveryError(null);
    setApiKey("");

    // If Ollama, automatically discover models from host
    if (providerId === "ollama") {
      const defaultHost = "http://localhost:11434";
      setApiBase(defaultHost);
      performModelDiscovery(providerId, "", defaultHost, apiVersion);
    } else {
      setApiBase("");
    }
  };

  const getEffectiveModel = () => {
    if (selectedModel === "custom") {
      return customModel.trim();
    }
    return selectedModel;
  };

  const handleTestConnection = async () => {
    const effectiveModel = getEffectiveModel();
    if (!effectiveModel) {
      showToast({ title: "Model Required", message: "Please select or enter a model name.", type: "warning" });
      return;
    }

    try {
      setTesting(true);
      setTestResult({ tested: false, success: false, message: "" });

      const res = await fetch(`${BACKEND_URL}/config/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          model: effectiveModel,
          apiKey,
          apiBase,
          apiVersion,
          organization,
        }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        setTestResult({
          tested: true,
          success: json.data.success,
          message: json.data.message,
          latencyMs: json.data.latencyMs,
        });

        if (json.data.success) {
          showToast({
            title: "Connection Verified",
            message: `${activeProviderDef.name} verified via LiteLLM (${json.data.latencyMs}ms).`,
            type: "success",
          });
        } else {
          showToast({
            title: "Verification Failed",
            message: json.data.message,
            type: "error",
          });
        }
      } else {
        setTestResult({
          tested: true,
          success: false,
          message: json.error || "Failed to contact LiteLLM via backend proxy.",
        });
      }
    } catch (err: any) {
      setTestResult({
        tested: true,
        success: false,
        message: err?.message || "Network error while testing provider configuration.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveToLiteLLM = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const effectiveModel = getEffectiveModel();

    if (!effectiveModel) {
      showToast({ title: "Model Required", message: "Please select or type a model name.", type: "warning" });
      return;
    }

    if (
      activeProviderDef.fields.apiKey &&
      selectedProvider !== "openai-compatible" &&
      !apiKey.trim()
    ) {
      showToast({ title: "API Key Required", message: "Please enter your provider API key.", type: "warning" });
      return;
    }

    try {
      setSaving(true);
      setConfigurationError(null);
      const res = await fetch(`${BACKEND_URL}/config/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          model: effectiveModel,
          apiKey,
          apiBase,
          apiVersion,
          organization,
        }),
      });

      const responseText = await res.text();
      let json: any;
      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch {
        json = { error: responseText || `Backend returned HTTP ${res.status} without a JSON error response.` };
      }

      if (res.ok && json.success && json.data) {
        showToast({
          title: "Saved in LiteLLM DB",
          message: `${activeProviderDef.name} registered in LiteLLM DB. Virtual key generated!`,
          type: "success",
        });
        setApiKey(""); // Clear sensitive raw key from form state
        await fetchConfig();
      } else {
        const errorMessage = json.error || json.message || json.data?.message ||
          `Backend could not configure this model (HTTP ${res.status}).`;
        setConfigurationError(errorMessage);
        showToast({
          title: "Configuration Failed",
          message: errorMessage,
          type: "error",
        });
      }
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to persist provider configuration.";
      setConfigurationError(errorMessage);
      showToast({
        title: "Error",
        message: errorMessage,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = (modelId: string, modelName: string) => {
    showConfirm({
      title: "Delete Model from LiteLLM",
      message: `Are you sure you want to delete model "${modelName}" from the LiteLLM database?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/config/model/${encodeURIComponent(modelId)}`, {
            method: "DELETE",
          });
          const json = await res.json();
          if (json.success) {
            showToast({ title: "Model Deleted", message: json.message, type: "success" });
            fetchConfig();
          } else {
            showToast({ title: "Error", message: json.message || "Failed to delete model", type: "error" });
          }
        } catch (err: any) {
          showToast({ title: "Error", message: err?.message || "Delete failed", type: "error" });
        }
      },
    });
  };

  const [activatingModel, setActivatingModel] = useState<string | null>(null);

  const handleSetActiveModel = async (modelName: string) => {
    try {
      setActivatingModel(modelName);
      const res = await fetch(`${BACKEND_URL}/config/active-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName }),
      });

      const json = await res.json();
      if (json.success) {
        showToast({
          title: "Active Model Updated",
          message: `'${modelName}' is now set as the active platform model.`,
          type: "success",
        });
        await fetchConfig();
      } else {
        showToast({
          title: "Activation Failed",
          message: json.error || json.message || "Failed to set active model.",
          type: "error",
        });
      }
    } catch (err: any) {
      showToast({
        title: "Error",
        message: err?.message || "Network error while setting active model.",
        type: "error",
      });
    } finally {
      setActivatingModel(null);
    }
  };

  const handleCopyVirtualKey = () => {
    if (!currentConfig?.virtualKey) return;
    navigator.clipboard.writeText(currentConfig.virtualKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="px-6 py-8 flex flex-col gap-8 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Model & Provider Configuration
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchConfig}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            {testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            <span>{testing ? "Testing..." : "Test Connection"}</span>
          </button>

          <button
            type="button"
            onClick={handleSaveToLiteLLM}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-all cursor-pointer shadow-sm hover:shadow active:scale-95"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{saving ? "Saving to LiteLLM..." : "Save & Apply"}</span>
          </button>
        </div>
      </div>

      {/* Step 1: Select Provider */}
      <div className="flex flex-col gap-3">
        {configurationError && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            <div className="font-semibold">Model configuration failed</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{configurationError}</div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold">1</span>
            <span>Select AI Model Provider</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PROVIDERS.map((p) => {
            const isSelected = p.id === selectedProvider;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProviderSelect(p.id)}
                className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                    : "border-border bg-surface hover:bg-surface-muted hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <div className="p-1.5 rounded-lg bg-surface border border-border">
                    {p.icon}
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isSelected
                        ? "bg-primary text-white"
                        : "bg-surface-muted text-muted-foreground border border-border"
                    }`}
                  >
                    {p.badge}
                  </span>
                </div>
                <span className="text-xs font-semibold text-foreground">{p.name}</span>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                  {p.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Form & Status Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Form (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-border pb-3.5">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold">2</span>
                <h3 className="text-sm font-semibold text-foreground">
                  {activeProviderDef.name} Credentials & Models
                </h3>
              </div>

              {/* Discovery Status Badge */}
              <div className="flex items-center gap-2">
                {discovering ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Discovering models...
                  </span>
                ) : discoveredModels.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-500 bg-green-500/10 px-2.5 py-0.5 rounded-full border border-green-500/20">
                    <CheckCircle2 className="w-3 h-3" /> Live Provider Models ({discoveredModels.length})
                  </span>
                ) : discoveryError ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-500 bg-red-500/10 px-2.5 py-0.5 rounded-full border border-red-500/20">
                    <AlertCircle className="w-3 h-3" /> Discovery Failed
                  </span>
                ) : selectedProvider !== "ollama" && !apiKey.trim() ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                    <Key className="w-3 h-3" /> API Key Required
                  </span>
                ) : null}
              </div>
            </div>

            {/* API Key Field */}
            {activeProviderDef.fields.apiKey && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <span>{activeProviderDef.fields.apiKeyLabel || "Provider API Key"}</span>
                    <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => performModelDiscovery(selectedProvider, apiKey, apiBase, apiVersion)}
                    disabled={discovering}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                  >
                    <Search className="w-3 h-3" />
                    <span>Discover Models for Key</span>
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      const newKey = e.target.value;
                      setApiKey(newKey);
                    }}
                    onBlur={() => {
                      if (apiKey.trim().length > 10) {
                        performModelDiscovery(selectedProvider, apiKey, apiBase, apiVersion);
                      }
                    }}
                    placeholder={activeProviderDef.fields.apiKeyPlaceholder || "Enter API Key..."}
                    className="w-full rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>Entering your key triggers live model discovery from {activeProviderDef.name}.</span>
                </p>
              </div>
            )}

            {/* API Base / Endpoint URL Field */}
            {activeProviderDef.fields.apiBase && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>{activeProviderDef.fields.apiBaseLabel || "API Base URL"}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">Endpoint address</span>
                </label>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  onBlur={() => {
                    if (apiBase.trim()) {
                      performModelDiscovery(selectedProvider, apiKey, apiBase, apiVersion);
                    }
                  }}
                  placeholder={activeProviderDef.fields.apiBasePlaceholder || "http://localhost:11434"}
                  className="w-full rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}

            {/* API Version Field (for Azure) */}
            {activeProviderDef.fields.apiVersion && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>API Version</span>
                  <span className="text-[11px] font-normal text-muted-foreground">Azure REST version</span>
                </label>
                <input
                  type="text"
                  value={apiVersion}
                  onChange={(e) => setApiVersion(e.target.value)}
                  placeholder="2024-02-01"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}

            {/* Organization Field (for OpenAI) */}
            {activeProviderDef.fields.organization && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>Organization ID (Optional)</span>
                  <span className="text-[11px] font-normal text-muted-foreground">org-...</span>
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="org-xxxxxxxxxxxxxxxx"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}

            {/* Discovered Models Section */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <span>Available Models</span>
                  <span className="text-red-500">*</span>
                </label>
                {(apiKey.trim() || selectedProvider === "ollama") && (
                  <button
                    type="button"
                    onClick={() => performModelDiscovery(selectedProvider, apiKey, apiBase, apiVersion)}
                    disabled={discovering}
                    className="text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${discovering ? "animate-spin" : ""}`} />
                    <span>Refresh Models</span>
                  </button>
                )}
              </div>

              {/* State 1: Key not yet entered for cloud providers */}
              {selectedProvider !== "ollama" && !apiKey.trim() ? (
                <div className="flex flex-col items-center justify-center p-5 border border-dashed border-border rounded-xl bg-surface-muted/30 text-center gap-1.5">
                  <Key className="w-5 h-5 text-muted-foreground/60" />
                  <p className="text-xs font-semibold text-foreground">
                    Enter your {activeProviderDef.name} API key to view models
                  </p>
                  <p className="text-[11px] text-muted-foreground max-w-sm">
                    Models are discovered in real time from the {activeProviderDef.name} API endpoint using your key.
                  </p>
                </div>
              ) : discovering ? (
                /* State 2: Discovering models */
                <div className="flex items-center justify-center gap-2.5 p-5 border border-border rounded-xl bg-surface-muted/30">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground font-medium">
                    Discovering live models from {activeProviderDef.name}...
                  </span>
                </div>
              ) : discoveryError ? (
                /* State 3: Discovery error */
                <div className="flex flex-col gap-2 p-3.5 border border-red-500/20 rounded-xl bg-red-500/10 text-xs">
                  <div className="flex items-start gap-2 text-red-500">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-semibold">Unable to discover models</span>
                      <span className="text-[11px] text-red-400/90">{discoveryError}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-red-500/10">
                    <button
                      type="button"
                      onClick={() => performModelDiscovery(selectedProvider, apiKey, apiBase, apiVersion)}
                      className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                    >
                      Retry Discovery
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel("custom");
                        setDiscoveryError(null);
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Enter model manually
                    </button>
                  </div>
                </div>
              ) : (
                /* State 4: Models loaded */
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                    >
                      {discoveredModels.length > 0 ? (
                        discoveredModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))
                      ) : (
                        <option value="" disabled>No models discovered</option>
                      )}
                      <option value="custom">-- Custom Model Name --</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleSaveToLiteLLM}
                      disabled={saving || !getEffectiveModel()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-all cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                      title="Save and set this model as active platform model"
                    >
                      {saving ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Set as Active Model</span>
                    </button>
                  </div>

                  {selectedModel === "custom" && (
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="Enter custom model identifier (e.g. gpt-4o, gemini/gemini-2.5-flash)..."
                      className="w-full rounded-lg border border-border bg-surface-muted px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 mt-1"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Test Result Alert */}
          {testResult.tested && (
            <div
              className={`flex items-start gap-3 rounded-xl border p-4 text-xs transition-all duration-300 ${
                testResult.success
                  ? "border-green-500/30 bg-green-500/10 text-foreground"
                  : "border-red-500/30 bg-red-500/10 text-foreground"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              )}
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    {testResult.success ? "Verification Passed" : "Verification Failed"}
                  </span>
                  {testResult.latencyMs !== undefined && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      Latency: {testResult.latencyMs}ms
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground leading-relaxed">{testResult.message}</p>
              </div>
            </div>
          )}

          {/* Models Saved in LiteLLM DB */}
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Models Configured in LiteLLM DB
                </h3>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {currentConfig?.configuredModels?.length || 0} registered in DB
              </span>
            </div>

            {currentConfig?.configuredModels && currentConfig.configuredModels.length > 0 ? (
              <div className="flex flex-col gap-2">
                {currentConfig.configuredModels.map((m) => {
                  const isActive = m.modelName === currentConfig.activeModel;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-colors ${
                        isActive
                          ? "border-green-500/40 bg-green-500/5"
                          : "border-border bg-surface-muted"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isActive ? "bg-green-500 shadow-[0_0_6px_#22c55e]" : "bg-muted-foreground"
                          }`}
                        />
                        <div className="flex flex-col">
                          <span className="font-mono font-semibold text-foreground">
                            {m.modelName}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Target: {m.litellmModel} • Provider: {m.provider}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-500 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            ACTIVE
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetActiveModel(m.modelName)}
                            disabled={activatingModel === m.modelName}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all cursor-pointer shadow-xs disabled:opacity-50"
                            title="Set this model as the active platform model"
                          >
                            {activatingModel === m.modelName ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            <span>Make Active</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteModel(m.id, m.modelName)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Delete model from LiteLLM DB"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground rounded-xl bg-surface-muted border border-dashed border-border">
                No custom models registered in LiteLLM database yet. Select a provider above and click Save.
              </div>
            )}
          </div>
        </div>

        {/* Right Column (4 cols): Active Status & Virtual Key */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Active Platform Runtime Status */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft flex flex-col gap-4">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center justify-between">
              <span>Platform Active Runtime</span>
              <span className={`w-2 h-2 rounded-full ${currentConfig?.isConfigured ? "bg-green-500 animate-pulse" : "bg-amber-500"}`} />
            </h4>

            {/* Active Model */}
            <div className="flex flex-col gap-1 p-3 rounded-xl bg-surface-muted border border-border">
              <span className="text-[11px] text-muted-foreground">Active Model in Platform</span>
              {currentConfig?.activeModel ? (
                <span className="text-xs font-mono font-semibold text-primary truncate" title={currentConfig.activeModel}>
                  {currentConfig.activeModel}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground italic font-sans">
                  No active model configured
                </span>
              )}
            </div>

            {/* Virtual Key Generated by LiteLLM */}
            <div className="flex flex-col gap-1 p-3 rounded-xl bg-surface-muted border border-border">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">LiteLLM Virtual Key</span>
                {currentConfig?.virtualKeyMasked ? (
                  <span className="text-[10px] font-semibold text-green-500 bg-green-500/10 px-1.5 py-0.2 rounded">
                    Generated by DB
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded">
                    Not Generated
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-1">
                {currentConfig?.virtualKeyMasked ? (
                  <>
                    <span className="text-xs font-mono text-foreground truncate max-w-[200px]">
                      {currentConfig.virtualKeyMasked}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyVirtualKey}
                      className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Copy virtual key"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic font-sans">
                    None (configure model above)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* How It Works Guide */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft flex flex-col gap-3.5 text-xs">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <HelpCircle className="w-4 h-4 text-primary" />
              <span>Dynamic Discovery Flow</span>
            </div>

            <ol className="text-muted-foreground flex flex-col gap-2.5 list-decimal list-inside leading-relaxed">
              <li>
                <strong>Select Provider</strong>: Choose your AI vendor.
              </li>
              <li>
                <strong>Enter API Key</strong>: The platform calls the provider endpoint in real-time to discover available models for your account.
              </li>
              <li>
                <strong>Select Model</strong>: Choose from dynamically discovered models.
              </li>
              <li>
                <strong>Save & Apply</strong>: The backend registers the model into the LiteLLM database (<code className="bg-surface-muted px-1 rounded text-foreground font-mono">/model/new</code>) and generates an authorized virtual key (<code className="bg-surface-muted px-1 rounded text-foreground font-mono">/key/generate</code>).
              </li>
              <li>
                <strong>All Agent Pipelines</strong> immediately use the newly provisioned LiteLLM model without rebuilding.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
