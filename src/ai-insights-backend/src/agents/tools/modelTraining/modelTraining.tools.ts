import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { getProjectDirectory } from "../filesystem/mcpFilesystemClient";

export const createReadTrainingContractTool = (
  trainingConfigState: Record<string, any>,
  projectId: string,
  runTimestamp: string,
  services?: any
) =>
  tool(
    async () => {
      try {

        const contractPath = trainingConfigState?.contractPath;
        if (typeof contractPath !== "string" || !contractPath.trim()) {
          throw new Error(`The active training contract path is missing for run ${runTimestamp}.`);
        }
        const parsed = yaml.load(fs.readFileSync(contractPath, "utf-8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`Training contract must be a YAML object: ${contractPath}`);
        }
        return {
          success: true,
          contractPath,
          configuration: parsed,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "readTrainingContract",
      description: "Reads and parses the active Training Job Contract YAML file containing candidate models, hyperparameters, and dataset split configurations.",
      schema: z.object({}),
    }
  );

export const createGetPreFlightDetailsTool = (preFlightState: Record<string, any>) =>
  tool(
    async () => {
      if (!preFlightState || Object.keys(preFlightState).length === 0) {
        return {
          success: false,
          decision: "UNKNOWN",
          summary: "PreFlight state not available",
          system: {},
          estimates: {},
        };
      }

      return {
        success: true,
        decision: preFlightState.decision || "APPROVED",
        status: preFlightState.status || "PASSED",
        summary: preFlightState.summary || "",
        system: preFlightState.system || {},
        estimates: preFlightState.estimates || {},
        recommendations: preFlightState.recommendations || [],
        hardwareDecision: {
          gpu_available: preFlightState.gpu_available,
          selected_resource: preFlightState.selected_resource,
          selected_strategy: preFlightState.selected_strategy,
        },
      };
    },
    {
      name: "getPreFlightDetails",
      description: "Retrieves preflight evaluation outputs including hardware capacity, GPU availability, resource estimates, and approved optimization strategies.",
      schema: z.object({}),
    }
  );

export const createValidateProjectStructureTool = (pythonProjectDir: string) =>
  tool(
    async () => {
      const requiredFiles = [
        "main.py",
        "pipeline.py",
        "requirements.txt",
        path.join("data", "data_loader.py"),
        path.join("models", "base_model.py"),
        path.join("evaluation", "metrics.py"),
        path.join("evaluation", "visualizer.py"),
      ];

      const missing: string[] = [];
      const present: string[] = [];

      for (const relFile of requiredFiles) {
        const fullPath = path.join(pythonProjectDir, relFile);
        if (fs.existsSync(fullPath)) {
          present.push(relFile.replace(/\\/g, "/"));
        } else {
          missing.push(relFile.replace(/\\/g, "/"));
        }
      }

      return {
        success: missing.length === 0,
        valid: missing.length === 0,
        presentFiles: present,
        missingFiles: missing,
        projectDirectory: pythonProjectDir,
      };
    },
    {
      name: "validateProjectStructure",
      description: "Validates that all essential Python project files (main.py, pipeline.py, data_loader.py, models, metrics, visualizer, requirements.txt) are created.",
      schema: z.object({}),
    }
  );
