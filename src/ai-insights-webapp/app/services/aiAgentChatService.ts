import { ChatMessage, ChatSession, AgentPersonaId, ThinkingStep, MetricCardData, TableData, ChartData } from "../components/chat/types";
import { AGENT_PERSONAS, INITIAL_CHAT_SESSIONS } from "../components/chat/constants";
import { Project, DataSource } from "../components/providers/AppContext";

const CHAT_STORAGE_KEY = "ai_insights_chat_sessions_v1";
const ACTIVE_SESSION_ID_KEY = "ai_insights_active_session_id_v1";

export function loadSavedChatSessions(): ChatSession[] {
  if (typeof window === "undefined") return INITIAL_CHAT_SESSIONS;
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to parse saved chat sessions:", err);
  }
  return INITIAL_CHAT_SESSIONS;
}

export function saveChatSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn("Failed to persist chat sessions:", err);
  }
}

export function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_SESSION_ID_KEY);
}

export function saveActiveSessionId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_SESSION_ID_KEY, id);
}

export function sendTextToAgent(text: string): void {
  if (typeof window === "undefined") return;
  try {
    const sessions = loadSavedChatSessions();
    const activeId = loadActiveSessionId() || (sessions.length > 0 ? sessions[0].id : null);
    if (!activeId || sessions.length === 0) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const updated = sessions.map((s) => {
      if (s.id === activeId) {
        return {
          ...s,
          messages: [...s.messages, userMessage],
          updatedAt: new Date().toISOString(),
        };
      }
      return s;
    });

    saveChatSessions(updated);
    window.dispatchEvent(new CustomEvent("agent_message_sent", { detail: { text, message: userMessage } }));
  } catch (err) {
    console.warn("Failed to send text to agent:", err);
  }
}

export async function generateAgentChatResponse(
  userQuery: string,
  personaId: AgentPersonaId,
  selectedProject?: Project | null,
  allProjects: Project[] = [],
  allDataSources: DataSource[] = [],
  onThinkingUpdate?: (thinking: ThinkingStep[]) => void
): Promise<Partial<ChatMessage>> {
  const persona = AGENT_PERSONAS[personaId] || AGENT_PERSONAS.orchestrator;
  const qLower = userQuery.toLowerCase();
  const projectName = selectedProject?.projectName || selectedProject?.name || "Global Workspace Scope";

  const steps: ThinkingStep[] = [
    { time: "00:01", text: `Analyzing query intent and activating ${persona.name}...`, done: false },
  ];
  onThinkingUpdate?.([...steps]);
  await new Promise((r) => setTimeout(r, 400));

  steps[0].done = true;
  steps.push({
    time: "00:02",
    text: selectedProject
      ? `Inspecting project '${selectedProject.projectName || selectedProject.name}' (Use case: ${selectedProject.name || selectedProject.useCase || "Time-series forecasting"})...`
      : `Scanning ${allProjects.length} projects and ${allDataSources.length} data sources across workspace...`,
    done: false,
  });
  onThinkingUpdate?.([...steps]);
  await new Promise((r) => setTimeout(r, 500));

  steps[1].done = true;
  steps.push({
    time: "00:03",
    text: `Executing domain rules for ${persona.role} and formulating insights...`,
    done: false,
  });
  onThinkingUpdate?.([...steps]);
  await new Promise((r) => setTimeout(r, 450));

  steps[2].done = true;
  steps.push({
    time: "00:04",
    text: "Structured response payload and verification complete.",
    done: true,
  });
  onThinkingUpdate?.([...steps]);

  const agentState = selectedProject?.agentState as Record<string, any> | undefined;
  const stageOutputs = agentState?.stageOutputs as Record<string, any> | undefined;
  const stageStatuses = agentState?.stageStatuses as Record<string, any> | undefined;

  let content = "";
  let metricCards: MetricCardData[] | undefined;
  let tables: TableData[] | undefined;
  let chart: ChartData | undefined;
  let codeSnippet: { language: string; code: string; filename?: string } | undefined;
  let suggestedActions: string[] = [];

  if (
    qLower.includes("data quality") ||
    qLower.includes("null") ||
    qLower.includes("schema") ||
    qLower.includes("inspect") ||
    personaId === "data-engineer"
  ) {
    const totalSources = selectedProject?.dataSources?.length || allDataSources.length || 2;
    content = `### 🛠️ Data Quality & Schema Inspection Report for **${projectName}**

The dataset was profiled across **${totalSources} connected data sources**. Schema validation verified primary key uniqueness, temporal consistency, and null distribution bounds.

#### Key Findings:
- **Missing Value Profile**: Target variable has **0.0% nulls**. Secondary features show **< 1.2% missing values**, successfully handled by median imputation and forward filling.
- **Cardinality & Types**: Discovered **14 numerical continuous features**, **4 categorical descriptors**, and **1 high-cardinality hierarchy dimension**.
- **Temporal Alignment**: Daily frequency observed with zero missing date gaps across the 24-month training window.`;

    metricCards = [
      { label: "Data Completeness", value: "99.4%", change: "+0.6%", trend: "up", details: "All critical columns valid" },
      { label: "Duplicate Records", value: "0", change: "0%", trend: "neutral", details: "Strict PK uniqueness verified" },
      { label: "Outlier Ratio", value: "0.8%", change: "-0.3%", trend: "down", details: "Within IQR 3.0 sigma bounds" },
      { label: "Connected Sources", value: totalSources, trend: "neutral", details: "Active connectors synced" },
    ];

    tables = [
      {
        columns: ["Column Name", "Data Type", "Null Count", "Null %", "Unique Values", "Status"],
        rows: [
          { "Column Name": "date_timestamp", "Data Type": "TIMESTAMP", "Null Count": 0, "Null %": "0.0%", "Unique Values": 730, Status: "✅ Healthy" },
          { "Column Name": "store_id", "Data Type": "VARCHAR(32)", "Null Count": 0, "Null %": "0.0%", "Unique Values": 45, Status: "✅ Healthy" },
          { "Column Name": "product_sku", "Data Type": "VARCHAR(64)", "Null Count": 0, "Null %": "0.0%", "Unique Values": 120, Status: "✅ Healthy" },
          { "Column Name": "sales_quantity", "Data Type": "FLOAT8", "Null Count": 0, "Null %": "0.0%", "Unique Values": 612, Status: "✅ Target Valid" },
          { "Column Name": "promotional_discount", "Data Type": "FLOAT8", "Null Count": 12, "Null %": "1.6%", "Unique Values": 18, Status: "⚠️ Imputed" },
        ],
      },
    ];

    codeSnippet = {
      language: "sql",
      filename: "data_quality_audit.sql",
      code: `-- Data Ingestion & Quality Audit Query
SELECT
    COUNT(*) AS total_records,
    COUNT(DISTINCT date_timestamp) AS distinct_dates,
    COUNT(*) - COUNT(sales_quantity) AS null_target_count,
    ROUND(AVG(sales_quantity)::numeric, 2) AS mean_sales,
    ROUND(STDDEV(sales_quantity)::numeric, 2) AS std_sales
FROM project_source_dataset
WHERE date_timestamp >= NOW() - INTERVAL '2 years';`,
    };

    suggestedActions = [
      "Show feature correlations with the target variable",
      "Explain how missing promotional discounts were imputed",
      "Trigger re-profiling on the latest dataset partition",
    ];
  } else if (
    qLower.includes("feature") ||
    qLower.includes("lag") ||
    qLower.includes("exogenous") ||
    personaId === "feature-architect"
  ) {
    content = `### ⚡ Feature Engineering Architecture for **${projectName}**

The Feature Architect evaluated **38 candidate feature transformations** and selected the top **12 high-impact predictors** based on Mutual Information and Feature Importance score rankings.

#### Engineered Feature Groups:
1. **Temporal & Calendar Signals**: Day of week sine/cosine cyclical encodings, holiday proximity indicators, and month-end flags.
2. **Lagged Target Dynamics**: 7-day, 14-day, 28-day historical demand lags with 7-day rolling window mean and standard deviations.
3. **Exogenous Regressors**: Scouted local CPI trend, promotional markdown depth, and regional temperature indexes.`;

    metricCards = [
      { label: "Features Selected", value: "12 / 38", change: "Top 31%", trend: "up", details: "Multicollinearity filtered" },
      { label: "Max Mutual Info", value: "0.742", trend: "up", details: "Target lag_7d" },
      { label: "VIF Threshold", value: "< 4.5", trend: "neutral", details: "No severe collinearity" },
    ];

    tables = [
      {
        columns: ["Feature Name", "Transformation Type", "Importance Score", "Mutual Info", "Lag Window"],
        rows: [
          { "Feature Name": "sales_lag_7d", "Transformation Type": "Autoregressive Lag", "Importance Score": "28.4%", "Mutual Info": "0.742", "Lag Window": "t-7" },
          { "Feature Name": "rolling_mean_14d", "Transformation Type": "Moving Average", "Importance Score": "21.1%", "Mutual Info": "0.685", "Lag Window": "t-1 to t-14" },
          { "Feature Name": "promo_discount_pct", "Transformation Type": "Exogenous Ratio", "Importance Score": "14.7%", "Mutual Info": "0.512", "Lag Window": "Current" },
          { "Feature Name": "dayofweek_sin", "Transformation Type": "Cyclical Trigonometric", "Importance Score": "11.2%", "Mutual Info": "0.428", "Lag Window": "Current" },
          { "Feature Name": "holiday_indicator", "Transformation Type": "Binary Calendar Flag", "Importance Score": "8.9%", "Mutual Info": "0.364", "Lag Window": "t+0 to t+3" },
        ],
      },
    ];

    chart = {
      type: "bar",
      title: "Top Feature Importance Distribution (%)",
      labels: ["sales_lag_7d", "rolling_mean_14d", "promo_discount", "dayofweek_sin", "holiday_indicator", "rolling_std_7d"],
      data: [28.4, 21.1, 14.7, 11.2, 8.9, 6.2],
    };

    codeSnippet = {
      language: "python",
      filename: "feature_architect_pipeline.py",
      code: `import numpy as np
import pandas as pd

def build_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["store_id", "product_sku", "date_timestamp"]).copy()

    # Target Autoregressive Lags
    df["sales_lag_7d"] = df.groupby(["store_id", "product_sku"])["sales_quantity"].shift(7)
    df["sales_lag_14d"] = df.groupby(["store_id", "product_sku"])["sales_quantity"].shift(14)

    # Rolling Statistics
    df["rolling_mean_14d"] = df.groupby(["store_id", "product_sku"])["sales_lag_7d"].transform(
        lambda x: x.rolling(14, min_periods=1).mean()
    )

    # Cyclical Calendar Features
    df["dayofweek"] = df["date_timestamp"].dt.dayofweek
    df["dayofweek_sin"] = np.sin(2 * np.pi * df["dayofweek"] / 7.0)
    df["dayofweek_cos"] = np.cos(2 * np.pi * df["dayofweek"] / 7.0)

    return df`,
    };

    suggestedActions = [
      "Compare model performance with and without exogenous features",
      "Export generated feature dataset to parquet",
      "Check SHAP feature summary plot",
    ];
  } else if (
    qLower.includes("model") ||
    qLower.includes("hyperparameter") ||
    qLower.includes("lightgbm") ||
    qLower.includes("xgboost") ||
    personaId === "ml-scientist"
  ) {
    content = `### 🔬 Machine Learning Model Selection & Training Report

For **${projectName}**, the ML Scientist tested **4 candidate model families** across identical walk-forward time splits.

#### Selected Champion Model: **LightGBM Regressor (Tuned)**
- **Why LightGBM Won**: Achieved lowest **WAPE (8.4%)** while demonstrating **4.2x faster inference latency** and robust handling of high-cardinality store-SKU embeddings compared to deep learning baselines.
- **Hyperparameter Tuning**: 60 iterations of Bayesian Optimization converged on ` +
      "`max_depth=7`, `learning_rate=0.038`, `num_leaves=63`, `feature_fraction=0.85`." +
      `
- **Ensemble Potential**: Blending LightGBM (70%) with CatBoost (30%) yields a marginal +0.4% WAPE gain with slight compute overhead.`;

    metricCards = [
      { label: "Champion Model", value: "LightGBM", trend: "up", details: "Rank #1 across validation splits" },
      { label: "Validation WAPE", value: "8.42%", change: "-2.1%", trend: "up", details: "vs 10.5% baseline" },
      { label: "Inference Latency", value: "14 ms", change: "Fast", trend: "up", details: "Batch prediction ready" },
      { label: "Train R² Score", value: "0.931", trend: "up", details: "High variance explained" },
    ];

    tables = [
      {
        columns: ["Model Family", "WAPE (%)", "RMSE", "MAE", "R² Score", "Training Time", "Status"],
        rows: [
          { "Model Family": "LightGBM (Tuned)", "WAPE (%)": "8.42%", RMSE: "124.5", MAE: "82.1", "R² Score": "0.931", "Training Time": "38s", Status: "🏆 Selected" },
          { "Model Family": "XGBoost Regressor", "WAPE (%)": "9.15%", RMSE: "136.2", MAE: "89.4", "R² Score": "0.918", "Training Time": "1m 12s", Status: "🥈 Candidate" },
          { "Model Family": "CatBoost Regressor", "WAPE (%)": "9.48%", RMSE: "141.0", MAE: "92.8", "R² Score": "0.912", "Training Time": "2m 04s", Status: "Candidate" },
          { "Model Family": "Prophet Seasonal", "WAPE (%)": "14.20%", RMSE: "198.4", MAE: "138.6", "R² Score": "0.825", "Training Time": "45s", Status: "Baseline" },
        ],
      },
    ];

    chart = {
      type: "bar",
      title: "Model Error Rate Comparison (WAPE % - Lower is Better)",
      labels: ["LightGBM (Tuned)", "XGBoost", "CatBoost", "Prophet Baseline"],
      data: [8.42, 9.15, 9.48, 14.2],
    };

    suggestedActions = [
      "Review validation backtest graphs",
      "Download model training configuration YAML",
      "Deploy model endpoint to staging environment",
    ];
  } else if (
    qLower.includes("validation") ||
    qLower.includes("metric") ||
    qLower.includes("error") ||
    qLower.includes("backtest") ||
    personaId === "validation-analyst"
  ) {
    content = `### 📊 Validation & Backtesting Audit for **${projectName}**

The model was subjected to a **5-fold expanding window backtest** evaluating 30-day forecast horizons across both standard demand periods and promotional holiday events.

#### Audit Summary:
- **Accuracy Grade**: **A (Production Ready)** with aggregate **WAPE = 8.42%** and **MAPE = 9.1%**.
- **Coverage Calibration**: 95% Confidence Intervals captured **94.6% of actual values**, confirming well-calibrated epistemic variance estimates.
- **Residual Normality**: Shapiro-Wilk and Ljung-Box tests confirm residuals are homoskedastic with zero meaningful autocorrelation remaining.`;

    metricCards = [
      { label: "Aggregate WAPE", value: "8.42%", trend: "up", details: "Goal < 10.0%" },
      { label: "95% CI Coverage", value: "94.6%", trend: "up", details: "Ideal target: 95.0%" },
      { label: "RMSE", value: "124.5", change: "-18.2", trend: "up", details: "Out-of-sample error" },
      { label: "Max Residual Bias", value: "+1.2%", trend: "neutral", details: "Minimal systematic over/under" },
    ];

    tables = [
      {
        columns: ["Split Horizon", "Date Window", "Actual Volume", "Predicted Volume", "WAPE (%)", "Coverage 95%"],
        rows: [
          { "Split Horizon": "Fold 1", "Date Window": "Jan - Feb", "Actual Volume": "142,500", "Predicted Volume": "144,120", "WAPE (%)": "7.9%", "Coverage 95%": "95.2%" },
          { "Split Horizon": "Fold 2", "Date Window": "Mar - Apr", "Actual Volume": "158,200", "Predicted Volume": "156,800", "WAPE (%)": "8.2%", "Coverage 95%": "94.8%" },
          { "Split Horizon": "Fold 3", "Date Window": "May - Jun", "Actual Volume": "164,900", "Predicted Volume": "162,400", "WAPE (%)": "8.6%", "Coverage 95%": "94.1%" },
          { "Split Horizon": "Fold 4", "Date Window": "Jul - Aug", "Actual Volume": "178,100", "Predicted Volume": "180,300", "WAPE (%)": "8.9%", "Coverage 95%": "94.4%" },
          { "Split Horizon": "Fold 5 (Holdout)", "Date Window": "Sep - Oct", "Actual Volume": "191,400", "Predicted Volume": "190,100", "WAPE (%)": "8.5%", "Coverage 95%": "94.6%" },
        ],
      },
    ];

    suggestedActions = [
      "View detailed residual error scatter plots",
      "Simulate demand shock scenario (+20% uplift)",
      "Approve workflow to proceed to deployment",
    ];
  } else {

    const statusText = String(selectedProject?.agentState?.status || "Ready");
    content = `### 🧠 AI Insights Platform Synthesis: **${projectName}**

Here is the operational intelligence overview synthesized by the **${persona.name}**:

#### Status & Architecture Overview:
- **Active Workspace Status**: All connectors and pipelines operating normally.
- **Workflow State**: **${statusText.toUpperCase()}** with automated pipeline orchestrators active.
- **Multi-Agent Capabilities**: Specialized agents are ready to assist with Data Engineering, Feature Architecture, ML Training, and Backtest Validation.

#### Recommended Next Steps:
1. **Explore Data Hierarchies**: Drill down into dimensional breakdowns (Region > Store > SKU).
2. **Review Model Explainability**: Inspect top SHAP drivers influencing predictions.
3. **Execute Simulations**: Test scenario adjustments directly in the interactive workspace.`;

    metricCards = [
      { label: "Active Projects", value: allProjects.length || 1, trend: "neutral", details: "Workspace scope" },
      { label: "Data Connectors", value: allDataSources.length || 2, trend: "up", details: "Live connections" },
      { label: "Active Agent", value: persona.name, trend: "neutral", details: persona.role },
      { label: "Pipeline Status", value: statusText, trend: "up", details: "Operational" },
    ];

    suggestedActions = [
      "Inspect Data Quality & Null Ratios",
      "Suggest High-Impact Features for my dataset",
      "Compare candidate ML models and explain tradeoffs",
      "Review validation error backtest breakdown",
    ];
  }

  return {
    role: "assistant",
    content,
    timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    thinking: steps,
    isThinking: false,
    agentId: persona.id,
    agentName: persona.name,
    agentBadge: persona.badge,
    agentAvatar: persona.avatar,
    metricCards,
    tables,
    chart,
    codeSnippet,
    suggestedActions,
    status: "complete",
  };
}
