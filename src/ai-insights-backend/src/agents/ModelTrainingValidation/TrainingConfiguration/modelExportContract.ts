import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

const exportFormatSchema = z.object({
  format_id: z.string().min(1),
  extension: z.string().regex(/^\.[^/\\]+$/).nullable(),
  format_name: z.string().min(1),
  status: z.enum(["supported", "conditional", "unsupported"]),
  selectable: z.boolean(),
  role: z.enum(["portable_inference", "native_model", "transformer_checkpoint", "quantized_llm", "accelerator_optimized"]),
  runtime: z.string().min(1).nullable(),
  requires_preprocessing: z.boolean(),
  required_assets: z.array(z.string().min(1)),
  validation_required: z.literal(true),
  limitations: z.array(z.string()),
}).passthrough();

export const modelExportCapabilitiesSchema = z.object({
  default_format: z.string().min(1).nullable(),
  selection_rationale: z.string().min(1),
  post_training_validation_required: z.literal(true),
  formats: z.array(exportFormatSchema),
}).passthrough().superRefine((capabilities, ctx) => {
  const ids = new Set<string>();
  capabilities.formats.forEach((format, index) => {
    if (ids.has(format.format_id)) {
      ctx.addIssue({ code: "custom", path: ["formats", index, "format_id"], message: "Duplicate export format ID." });
    }
    ids.add(format.format_id);
    if (format.status === "unsupported" && format.selectable) {
      ctx.addIssue({ code: "custom", path: ["formats", index, "selectable"], message: "Unsupported formats cannot be selectable." });
    }
  });
  if (capabilities.default_format !== null && !capabilities.formats.some(
    (format) => format.format_id === capabilities.default_format && format.selectable && format.status !== "unsupported"
  )) {
    ctx.addIssue({ code: "custom", path: ["default_format"], message: "The primary export must reference a selectable supported or conditional format." });
  }
});

export const exportPolicySchema = z.object({
  mode: z.literal("multiple_formats"),
  include_native_format: z.boolean(),
  include_conditional_formats: z.boolean(),
  validate_after_export: z.literal(true),
  require_prediction_parity: z.boolean(),
  include_preprocessing_assets: z.boolean(),
  include_inference_manifest: z.boolean(),
}).passthrough();

const exportContractSchema = z.object({
  model_selection: z.object({
    models: z.array(z.object({
      model_id: z.string().min(1),
      enabled: z.boolean(),
      export_capabilities: modelExportCapabilitiesSchema,
    }).passthrough()).min(1),
  }),
  artifacts: z.object({ export_policy: exportPolicySchema }),
});

export const modelExportArtifactSchema = z.object({
  format_id: z.string().min(1),
  artifact_path: z.string().min(1),
  status: z.string().optional(),
  export_status: z.string().optional(),
  format_name: z.string().optional(),
  extension: z.string().optional(),
  runtime: z.string().min(1).nullable().optional(),
  assets: z.record(z.string(), z.string().min(1)).optional().default({}),
  validation: z.object({
    reloaded: z.boolean().optional(),
    prediction_parity_passed: z.boolean().optional(),
  }).passthrough().optional().default({}),
}).passthrough();

export type ModelExportCapabilities = z.infer<typeof modelExportCapabilitiesSchema>;
export type ModelExportArtifact = z.infer<typeof modelExportArtifactSchema>;
export interface ModelExportPlan {
  model_id: string;
  default_format: string;
  formats: ModelExportCapabilities["formats"];
}

export function validateExportConfiguration(configuration: unknown): string[] {
  const result = exportContractSchema.safeParse(configuration);
  if (!result.success) {
    return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const model of result.data.model_selection.models) {
    if (ids.has(model.model_id)) errors.push(`Duplicate model ID '${model.model_id}'.`);
    ids.add(model.model_id);
    const primary = model.export_capabilities.formats.find((format) => format.format_id === model.export_capabilities.default_format);
    if (primary && !isRequestedFormat(primary, result.data.artifacts.export_policy)) {
      errors.push(`Model '${model.model_id}' primary export is excluded by artifacts.export_policy.`);
    }
  }
  return errors;
}

function isRequestedFormat(format: ModelExportCapabilities["formats"][number], policy: z.infer<typeof exportPolicySchema>): boolean {
  return format.selectable && format.status !== "unsupported"
    && (format.status !== "conditional" || policy.include_conditional_formats)
    && (format.role !== "native_model" || policy.include_native_format);
}

export function getModelExportPlans(configuration: unknown): ModelExportPlan[] {
  const errors = validateExportConfiguration(configuration);
  if (errors.length > 0) throw new Error(`Invalid training export configuration. Regenerate Training Configuration.\n${errors.join("\n")}`);
  const contract = exportContractSchema.parse(configuration);
  return contract.model_selection.models.filter((model) => model.enabled).map((model) => {
    const formats = model.export_capabilities.formats.filter((format) => isRequestedFormat(format, contract.artifacts.export_policy));
    const primary = model.export_capabilities.default_format;
    if (primary === null || formats.length === 0) {
      throw new Error(`Model '${model.model_id}' requires a researched, selectable primary export before training. Update Training Configuration.`);
    }
    return { model_id: model.model_id, default_format: primary, formats };
  });
}

export function validateModelExports(configuration: any, report: any, trainingDirectory: string, selectedModelIds: string[]): string[] {
  const errors: string[] = [];
  if (report?.status !== "Completed") errors.push("Training report must declare status 'Completed'.");
  const models = new Map<string, any>();
  if (!Array.isArray(report?.models_evaluated)) return ["Training report must contain models_evaluated with export results."];
  for (const model of report.models_evaluated) {
    if (models.has(model.model_id)) errors.push(`Duplicate model '${model.model_id}' in training report.`);
    models.set(model.model_id, model);
  }
  const root = fs.realpathSync(trainingDirectory);
  const checkArtifact = (relativePath: string): void => {
    if (path.isAbsolute(relativePath)) throw new Error(`Artifact paths must be relative to the training project: ${relativePath}`);
    const absolutePath = fs.realpathSync(path.resolve(root, relativePath));
    const relative = path.relative(root, absolutePath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Artifact is outside the training project: ${relativePath}`);
    }
    const stat = fs.statSync(absolutePath);
    if ((stat.isFile() && stat.size === 0) || (stat.isDirectory() && fs.readdirSync(absolutePath).length === 0)) {
      throw new Error(`Export artifact is empty: ${relativePath}`);
    }
  };
  const selected = new Set(selectedModelIds);
  const availablePlans = new Map(getModelExportPlans(configuration).map((plan) => [plan.model_id, plan]));
  const plans: ModelExportPlan[] = [];
  for (const modelId of selected) {
    const plan = availablePlans.get(modelId);
    if (!plan) errors.push(`Selected model '${modelId}' has no enabled export plan in the training contract.`);
    else plans.push(plan);
  }
  if (models.size !== selected.size || [...models.keys()].some((modelId) => !selected.has(modelId))) {
    errors.push("Training report model IDs must match the selected model IDs exactly.");
  }
  for (const plan of plans) {
    try {
      const model = models.get(plan.model_id);
      if (!model || model.status !== "Completed" || model.error || model.default_format !== plan.default_format) {
        throw new Error(`Model '${plan.model_id}' must report successful training and its configured primary export '${plan.default_format}'.`);
      }
      const exports = z.array(modelExportArtifactSchema).parse(model.exports);
      const byFormat = new Map(exports.map((item) => [item.format_id, item]));
      if (byFormat.size !== exports.length || exports.length !== plan.formats.length) {
        throw new Error(`Model '${plan.model_id}' exports must match the requested format IDs exactly, without duplicates.`);
      }
      if (new Set(exports.map((item) => item.artifact_path)).size !== exports.length) {
        throw new Error(`Model '${plan.model_id}' must use a distinct artifact path for each export format.`);
      }
      for (const format of plan.formats) {
        const artifact = byFormat.get(format.format_id);
        if (!artifact) throw new Error(`Model '${plan.model_id}' is missing export '${format.format_id}'.`);
        checkArtifact(artifact.artifact_path);
        if (format.extension !== null && !artifact.artifact_path.endsWith(format.extension)) {
          throw new Error(`Export '${format.format_id}' must use configured extension '${format.extension}'.`);
        }
        if (format.runtime !== artifact.runtime) throw new Error(`Export '${format.format_id}' must declare its configured runtime.`);
        if (configuration.artifacts.export_policy.require_prediction_parity && !artifact.validation?.prediction_parity_passed) {
          throw new Error(`Prediction parity failed for '${plan.model_id}/${format.format_id}'.`);
        }
        for (const assetId of format.required_assets) {
          if (!artifact.assets?.[assetId]) throw new Error(`Export '${format.format_id}' is missing required asset '${assetId}'.`);
        }
        for (const assetPath of Object.values(artifact.assets || {})) checkArtifact(assetPath);
      }
      const primary = byFormat.get(plan.default_format)!;
      if (model.artifact_path !== primary.artifact_path) throw new Error(`Model '${plan.model_id}' artifact_path must reference its primary export.`);
      if (configuration.artifacts.export_policy.include_inference_manifest) {
        if (typeof model.inference_manifest_path !== "string") throw new Error(`Model '${plan.model_id}' is missing its inference manifest.`);
        checkArtifact(model.inference_manifest_path);
        const manifest = JSON.parse(fs.readFileSync(path.resolve(root, model.inference_manifest_path), "utf-8"));
        const manifestExports = new Map<string, any>(Array.isArray(manifest.exports)
          ? manifest.exports.map((entry: any) => [entry.format_id, entry])
          : []);
        if (manifest.model_id !== plan.model_id || manifest.default_format !== plan.default_format
          || manifestExports.size !== exports.length || manifest.exports.length !== exports.length
          || exports.some((item) => manifestExports.get(item.format_id)?.artifact_path !== item.artifact_path)) {
          throw new Error(`Inference manifest does not match exports for '${plan.model_id}'.`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const champion = models.get(report?.best_model_id);
  if (!champion || !selected.has(report.best_model_id) || report.selected_model_path !== champion.artifact_path
    || report.best_model?.model_path !== champion.artifact_path) {
    errors.push("Training report must reference the champion's configured primary artifact in selected_model_path.");
  }
  return errors;
}
