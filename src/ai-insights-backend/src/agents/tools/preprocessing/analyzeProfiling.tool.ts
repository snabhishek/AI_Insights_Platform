import { tool } from "@langchain/core/tools";
import { z } from "zod";

type CleaningAction = {
  tableName: string;
  columnName: string;
  issue: string;
  suggestedMethod: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
};

const analyzeCompletenessIssues = (tableName: string, completenessData: any): CleaningAction[] => {
  const actions: CleaningAction[] = [];
  const columns = Array.isArray(completenessData?.columns) ? completenessData.columns : [];

  for (const col of columns) {
    const name = col?.name || "unknown";
    const pct = typeof col?.completenessPercent === "number" ? col.completenessPercent : 100;
    const pattern = col?.missingPattern || "unknown";

    if (pct >= 100) continue;

    if (pct < 30) {
      actions.push({
        tableName, columnName: name,
        issue: `Extremely low completeness (${pct}%)`,
        suggestedMethod: "drop_column",
        priority: "HIGH", confidence: "HIGH",
        reasoning: `Column has ${pct}% completeness. Consider dropping unless business-critical. Missing pattern: ${pattern}`,
      });
    } else if (pct < 70) {
      const method = pattern === "MCAR" ? "impute_median" : pattern === "MAR" ? "impute_predictive" : "impute_constant";
      actions.push({
        tableName, columnName: name,
        issue: `Low completeness (${pct}%)`,
        suggestedMethod: method,
        priority: "HIGH", confidence: "MEDIUM",
        reasoning: `Missing pattern ${pattern} suggests ${method}. ${col?.totalMissing || 0} values missing.`,
      });
    } else if (pct < 95) {
      actions.push({
        tableName, columnName: name,
        issue: `Moderate missing values (${pct}% complete)`,
        suggestedMethod: "impute_median",
        priority: "MEDIUM", confidence: "HIGH",
        reasoning: `Small number of missing values (${col?.totalMissing || 0}). Median/mode imputation safe.`,
      });
    }
  }
  return actions;
};

const analyzeContentIssues = (tableName: string, contentData: any): CleaningAction[] => {
  const actions: CleaningAction[] = [];
  const columns = Array.isArray(contentData?.columns) ? contentData.columns : [];

  for (const col of columns) {
    const name = col?.name || "unknown";
    const mixedPct = typeof col?.mixedTypePercent === "number" ? col.mixedTypePercent : 0;
    const classification = col?.categoricalOrContinuous || "unknown";
    const distinctCount = typeof col?.distinctCount === "number" ? col.distinctCount : 0;
    const totalValues = typeof col?.totalValues === "number" ? col.totalValues : 0;

    if (mixedPct > 10) {
      actions.push({
        tableName, columnName: name,
        issue: `Mixed data types detected (${mixedPct}% non-dominant type)`,
        suggestedMethod: "coerce_type",
        priority: "HIGH", confidence: "MEDIUM",
        reasoning: `Column has ${mixedPct}% values of non-dominant type. Inferred type: ${col?.inferredType}. Needs type coercion.`,
      });
    }

    if (classification === "categorical" && distinctCount > 0) {
      const topValues = Array.isArray(col?.topValues) ? col.topValues : [];
      const hasInconsistencies = topValues.some((tv: any) =>
        topValues.some((other: any) =>
          tv.value !== other.value &&
          tv.value.toLowerCase().trim() === other.value.toLowerCase().trim()
        )
      );
      if (hasInconsistencies) {
        actions.push({
          tableName, columnName: name,
          issue: "Inconsistent categorical values (case/whitespace variations)",
          suggestedMethod: "normalize_categories",
          priority: "MEDIUM", confidence: "HIGH",
          reasoning: "Top values contain case/whitespace variants of the same category.",
        });
      }
    }

    if (totalValues > 0 && distinctCount === totalValues && classification !== "identifier") {
      actions.push({
        tableName, columnName: name,
        issue: "All values are unique — potential identifier or data quality issue",
        suggestedMethod: "review_column",
        priority: "LOW", confidence: "LOW",
        reasoning: `${distinctCount}/${totalValues} distinct values. May be an identifier or have no analytical value.`,
      });
    }
  }
  return actions;
};

const analyzeStatisticalIssues = (tableName: string, statisticalData: any): CleaningAction[] => {
  const actions: CleaningAction[] = [];

  const numericCols = Array.isArray(statisticalData?.numericColumns) ? statisticalData.numericColumns : [];
  for (const col of numericCols) {
    const name = col?.name || "unknown";
    const outlierCount = col?.outliers?.count || 0;
    const shape = col?.distributionShape || "unknown";
    const skewness = typeof col?.skewness === "number" ? col.skewness : 0;

    if (outlierCount > 0) {
      const method = shape === "normal" || shape === "approximately_normal" ? "clip_iqr" : "cap_percentile";
      actions.push({
        tableName, columnName: name,
        issue: `${outlierCount} outlier(s) detected`,
        suggestedMethod: method,
        priority: outlierCount > 5 ? "HIGH" : "MEDIUM",
        confidence: "HIGH",
        reasoning: `Distribution is ${shape}. ${method} recommended. Bounds: [${col?.outliers?.lowerBound}, ${col?.outliers?.upperBound}].`,
      });
    }

    if (Math.abs(skewness) > 2) {
      actions.push({
        tableName, columnName: name,
        issue: `Highly skewed distribution (skewness: ${skewness})`,
        suggestedMethod: "log_transform",
        priority: "LOW", confidence: "MEDIUM",
        reasoning: `Skewness ${skewness} indicates heavy ${skewness > 0 ? "right" : "left"} tail. Log/power transform may help downstream models.`,
      });
    }

    if (col?.stddev === 0 && col?.count > 1) {
      actions.push({
        tableName, columnName: name,
        issue: "Zero variance — constant column",
        suggestedMethod: "drop_column",
        priority: "MEDIUM", confidence: "HIGH",
        reasoning: "Column has no variance. Provides no information for analysis.",
      });
    }
  }

  return actions;
};

export const createAnalyzeProfilingTool = () =>
  tool(
    async ({ profilingOutput }) => {
      const profile = (profilingOutput || {}) as Record<string, unknown>;
      const allActions: CleaningAction[] = [];

      // Handle multi-table structure: iterate tables array or single-table
      const tables = Array.isArray((profile as any)?.tables)
        ? (profile as any).tables
        : [profile];

      for (const tableProfile of tables) {
        const tableName = tableProfile?.tableName || "unknown";
        const completeness = tableProfile?.completenessProfile || tableProfile?.completeness;
        const content = tableProfile?.contentProfile || tableProfile?.content;
        const statistical = tableProfile?.statisticalProfile || tableProfile?.statistical;

        if (completeness) {
          allActions.push(...analyzeCompletenessIssues(tableName, completeness));
        }
        if (content) {
          allActions.push(...analyzeContentIssues(tableName, content));
        }
        if (statistical) {
          allActions.push(...analyzeStatisticalIssues(tableName, statistical));
        }
      }

      // Sort by priority
      const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      allActions.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

      return {
        totalActions: allActions.length,
        highPriority: allActions.filter((a) => a.priority === "HIGH").length,
        mediumPriority: allActions.filter((a) => a.priority === "MEDIUM").length,
        lowPriority: allActions.filter((a) => a.priority === "LOW").length,
        actions: allActions,
      };
    },
    {
      name: "analyzeProfiling",
      description:
        "Analyze the output of data profiling tools and generate a prioritized list of data cleaning actions. " +
        "Examines completeness issues, content/value distribution problems (mixed types, inconsistent categories), " +
        "and statistical anomalies (outliers, skewness, zero-variance columns). " +
        "Returns actions sorted by priority (HIGH → MEDIUM → LOW) with specific method suggestions and reasoning.",
      schema: z.object({
        profilingOutput: z.record(z.string(), z.any()).describe(
          "The complete profiling output from the DataProfile agent, containing completeness, content, and statistical profiles per table"
        ),
      }),
    }
  );
