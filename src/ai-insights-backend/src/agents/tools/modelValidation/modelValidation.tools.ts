import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  getFileServerBasePath,
  sanitizeFolderName,
} from "../../../config/fileServer.config";

function resolveProjectRoot(
  projectId: string,
  runTimestamp: string,
  projectName: string,
  workspaceName: string
): string {
  return path.join(
    getFileServerBasePath(),
    "workspaces",
    sanitizeFolderName(workspaceName || "Default_Workspace"),
    "projects",
    sanitizeFolderName(projectName || "Forecasting")
  );
}

export const createReadTrainingReportTool = (
  projectId: string,
  runTimestamp: string,
  projectName: string,
  workspaceName: string
) =>
  tool(
    async () => {
      try {
        const projectRoot = resolveProjectRoot(projectId, runTimestamp, projectName, workspaceName);
        const runDir = runTimestamp ? path.join(projectRoot, runTimestamp) : projectRoot;
        const modelTrainingDir = path.join(runDir, `${projectName}_model_training`);

        const reportCandidates = [
          path.join(modelTrainingDir, "reports", "model_training_report.json"),
          path.join(modelTrainingDir, "model_training_report.json"),
          path.join(runDir, "model_training_report.json"),
        ];

        for (const reportPath of reportCandidates) {
          if (fs.existsSync(reportPath)) {
            const raw = fs.readFileSync(reportPath, "utf-8");
            const report = JSON.parse(raw);
              const rawCandidates =
                report.models_evaluated ||
                report.candidate_models_evaluated ||
                report.model_results ||
                report.candidate_model_results ||
                report.candidate_models ||
                report.models ||
                report.runs ||
                {};

              const candidateModels = Array.isArray(rawCandidates)
                ? rawCandidates.map((m: any) => (typeof m === "string" ? m : m.model_id || m.id)).filter(Boolean)
                : Object.keys(rawCandidates);

              const championModelId =
                (typeof report.best_model === "string" ? report.best_model : report.best_model?.model_id) ||
                (typeof report.selected_model === "string" ? report.selected_model : report.selected_model?.model_id) ||
                (typeof report.champion_model === "string" ? report.champion_model : report.champion_model?.model_id) ||
                report.best_model_id ||
                report.champion_model_id ||
                null;

              const modelResults = Array.isArray(rawCandidates)
                ? rawCandidates.reduce((acc: any, cur: any) => {
                    const id = typeof cur === "string" ? cur : (cur.model_id || cur.id);
                    if (id) acc[id] = cur;
                    return acc;
                  }, {})
                : rawCandidates;

              return {
                success: true,
                reportPath,
                report,
                candidateModels,
                championModelId,
                testMetrics: modelResults,
              };
          }
        }

        return {
          success: false,
          error: `Training report not found for run ${runTimestamp} in project ${projectName}`,
          searchedPaths: reportCandidates,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "readTrainingReport",
      description:
        "Reads and parses the model_training_report.json from the training directory. Returns candidate model results, test metrics, champion model ID, and feature information.",
      schema: z.object({}),
    }
  );

export const createReadTrainedModelsMetadataTool = (modelsDir: string) =>
  tool(
    async () => {
      try {
        if (!fs.existsSync(modelsDir)) {
          return {
            success: false,
            error: `Models directory not found: ${modelsDir}`,
            models: [],
            hasPreprocessor: false,
          };
        }

        const allFiles = fs.readdirSync(modelsDir);
        const modelFiles = allFiles.filter(
          (f) =>
            f.endsWith(".joblib") &&
            f !== "preprocessor.joblib" &&
            f !== "selected_model.joblib"
        );

        const models = modelFiles.map((f) => {
          const fullPath = path.join(modelsDir, f);
          const stats = fs.statSync(fullPath);
          return {
            fileName: f,
            modelId: path.basename(f, ".joblib"),
            sizeBytes: stats.size,
            sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          };
        });

        const hasPreprocessor = fs.existsSync(
          path.join(modelsDir, "preprocessor.joblib")
        );

        const hasSelectedModel = fs.existsSync(
          path.join(modelsDir, "selected_model.joblib")
        );

        return {
          success: true,
          modelsDir,
          models,
          modelCount: models.length,
          hasPreprocessor,
          hasSelectedModel,
          allFiles: allFiles,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          models: [],
          hasPreprocessor: false,
        };
      }
    },
    {
      name: "readTrainedModelsMetadata",
      description:
        "Lists all trained model .joblib artifacts in the models directory, their sizes, and whether a preprocessor.joblib is available.",
      schema: z.object({}),
    }
  );

export const createReadValidationConfigTool = (
  modelTrainingDir: string,
  runDir: string
) =>
  tool(
    async () => {
      try {

        let trainingConfig: Record<string, any> = {};
        const trainingConfigPath = path.join(
          modelTrainingDir,
          "configs",
          "training_config.yaml"
        );
        if (fs.existsSync(trainingConfigPath)) {
          const raw = fs.readFileSync(trainingConfigPath, "utf-8");
          trainingConfig = (yaml.load(raw) as Record<string, any>) || {};
        }

        let existingValidationConfig: Record<string, any> | null = null;
        const candidateValConfigPaths = [
          path.join(
            runDir,
            `${path.basename(modelTrainingDir).replace(/_model_training$/, "_model_validation")}`,
            "configs",
            "validation_config.yaml"
          ),
          path.join(runDir, "model_validation", "configs", "validation_config.yaml"),
        ];
        for (const vp of candidateValConfigPaths) {
          if (fs.existsSync(vp)) {
            const raw = fs.readFileSync(vp, "utf-8");
            existingValidationConfig = (yaml.load(raw) as Record<string, any>) || null;
            if (existingValidationConfig) break;
          }
        }

        const rawValidatedFeatures =
          existingValidationConfig?.validated_features ||
          trainingConfig?.upstream_artifacts?.validated_features ||
          trainingConfig?.upstream_artifacts?.validatedFeatures ||
          trainingConfig?.validated_features ||
          trainingConfig?.validatedFeatures ||
          trainingConfig?.features ||
          trainingConfig?.features_list ||
          trainingConfig?.feature_list ||
          [];

        const validatedFeatures: string[] = Array.isArray(rawValidatedFeatures)
          ? rawValidatedFeatures.map((f: any) => String(f).trim()).filter(Boolean)
          : [];

        const schema = {
          targetColumn:
            trainingConfig?.task?.target_column ||
            trainingConfig?.target_column ||
            null,
          timeColumn:
            trainingConfig?.split?.time_column ||
            trainingConfig?.time_column ||
            null,
          splitDate:
            trainingConfig?.split?.split_date ||
            trainingConfig?.split_date ||
            null,
          splitEndDate:
            trainingConfig?.split?.split_end_date ||
            trainingConfig?.split_end_date ||
            null,
          problemType:
            trainingConfig?.task?.task_type ||
            trainingConfig?.problem_type ||
            null,
          groupBy:
            trainingConfig?.split?.group_by ||
            trainingConfig?.group_by ||
            null,
          validatedFeatures,
        };

        return {
          success: true,
          trainingConfigPath,
          trainingConfig,
          schema,
          existingValidationConfig,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          trainingConfig: {},
          schema: {},
        };
      }
    },
    {
      name: "readValidationConfig",
      description:
        "Reads training_config.yaml and any existing validation configuration. Returns dataset schema details including target column, time column, split dates, problem type, grouping column, and validated features array.",
      schema: z.object({}),
    }
  );

export const createValidateValidationOutputTool = (
  modelValidationDir: string
) =>
  tool(
    async () => {
      try {
        const expectedFiles = [
          "validation_runner.py",
          path.join("reports", "model_validation_report.json"),
          path.join("artifacts", "predictions", "validation_predictions.parquet"),
          path.join("configs", "validation_config.yaml"),
        ];

        const results: Array<{
          file: string;
          exists: boolean;
          sizeBytes?: number;
        }> = [];
        const missing: string[] = [];
        const present: string[] = [];

        for (const relFile of expectedFiles) {
          const fullPath = path.join(modelValidationDir, relFile);
          const exists = fs.existsSync(fullPath);
          if (exists) {
            const stats = fs.statSync(fullPath);
            results.push({
              file: relFile.replace(/\\/g, "/"),
              exists: true,
              sizeBytes: stats.size,
            });
            present.push(relFile.replace(/\\/g, "/"));
          } else {
            results.push({ file: relFile.replace(/\\/g, "/"), exists: false });
            missing.push(relFile.replace(/\\/g, "/"));
          }
        }

        let reportValid = false;
        const reportPath = path.join(
          modelValidationDir,
          "reports",
          "model_validation_report.json"
        );
        if (fs.existsSync(reportPath)) {
          try {
            JSON.parse(fs.readFileSync(reportPath, "utf-8"));
            reportValid = true;
          } catch {
            reportValid = false;
          }
        }

        return {
          success: missing.length === 0,
          valid: missing.length === 0,
          presentFiles: present,
          missingFiles: missing,
          fileDetails: results,
          reportValid,
          validationDirectory: modelValidationDir,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          presentFiles: [],
          missingFiles: [],
        };
      }
    },
    {
      name: "validateValidationOutput",
      description:
        "Validates that all expected validation output files exist: validation_runner.py, model_validation_report.json, validation_predictions.parquet, and validation_config.yaml.",
      schema: z.object({}),
    }
  );
