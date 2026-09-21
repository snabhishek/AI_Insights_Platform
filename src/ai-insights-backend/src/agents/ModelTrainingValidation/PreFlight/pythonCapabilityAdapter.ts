import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";
import { SystemHardwareSnapshot, ResourceEstimations, PreFlightReport } from "./types";

const execFileAsync = promisify(execFile);

export class PythonCapabilityAdapter {
  private serviceUrl: string;
  private pythonServicePath: string;

  constructor(serviceUrl = process.env.AI_INSIGHTS_SERVICE_URL || "http://127.0.0.1:8000") {
    this.serviceUrl = serviceUrl;
    // Resolve path to ai-insights-service
    this.pythonServicePath = path.resolve(__dirname, "../../../../../ai-insights-service");
    if (!fs.existsSync(this.pythonServicePath)) {
      // Fallback relative to project root
      const fallback = path.resolve(process.cwd(), "../ai-insights-service");
      if (fs.existsSync(fallback)) {
        this.pythonServicePath = fallback;
      }
    }
  }

  /**
   * Executes the full preflight pipeline via Python FastAPI service or local CLI fallback.
   */
  async runPreflightPipeline(config: any): Promise<{
    success: boolean;
    status: "online" | "fallback_cli" | "unavailable";
    system: SystemHardwareSnapshot;
    capabilities: any[];
    decision: any;
    raw?: any;
    error?: string;
  }> {
    // 1. Try HTTP microservice first
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.serviceUrl}/preflight/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = (await res.json()) as any;
        return {
          success: true,
          status: "online",
          system: this.normalizeSystem(data.system),
          capabilities: data.capabilities || [],
          decision: data.decision || {},
          raw: data,
        };
      }
    } catch (httpErr: any) {
      // HTTP service offline or unreachable, proceeding to CLI fallback
    }

    // 2. Fallback to CLI execution
    try {
      const configJson = JSON.stringify(config || {});
      const b64 = Buffer.from(configJson).toString("base64");

      const pythonExec = process.env.PYTHON_PATH || "python";
      const { stdout, stderr } = await execFileAsync(
        pythonExec,
        ["-m", "app.pre_flight.run_preflight", "--config-b64", b64],
        {
          cwd: this.pythonServicePath,
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      if (stdout) {
        const parsed = JSON.parse(stdout.trim());
        return {
          success: true,
          status: "fallback_cli",
          system: this.normalizeSystem(parsed.system),
          capabilities: parsed.capabilities || [],
          decision: parsed.decision || {},
          raw: parsed,
        };
      }
    } catch (cliErr: any) {
      // CLI execution also failed
    }

    // 3. Resilient fallback using native Node.js platform info
    const fallbackSystem = this.buildNodeFallbackSystem();
    return {
      success: false,
      status: "unavailable",
      system: fallbackSystem,
      capabilities: [
        {
          execution_kind: "cpu",
          backend: "cpu",
          supported: true,
          reason: "Fallback CPU execution (Python service offline)",
          optimizations: ["batch_size_reduction", "worker_count_reduction"],
        },
      ],
      decision: {
        status: "run_directly",
        execution_kind: "cpu",
        backend: "cpu",
        device: "cpu",
        bottleneck: "none",
        optimizations: [],
        estimate: {
          confidence: "insufficient_data",
          source: "insufficient_data",
          warnings: ["Python capability service unavailable; estimations based on platform heuristics"],
        },
        reasons: ["Fallback execution path active"],
        warnings: ["Python capability service unavailable"],
        requires_validation: true,
      },
      error: "Python microservice and CLI are unreachable",
    };
  }

  private normalizeSystem(rawSystem: any): SystemHardwareSnapshot {
    if (!rawSystem) return this.buildNodeFallbackSystem();

    return {
      os_name: rawSystem.os_name || os.type(),
      architecture: rawSystem.architecture || os.arch(),
      cpu_physical: Number(rawSystem.cpu_physical) || os.cpus().length,
      cpu_logical: Number(rawSystem.cpu_logical) || os.cpus().length,
      ram_total_gb: Number(rawSystem.ram_total_gb) || Math.round((os.totalmem() / 1024 ** 3) * 100) / 100,
      ram_available_gb: Number(rawSystem.ram_available_gb) || Math.round((os.freemem() / 1024 ** 3) * 100) / 100,
      disk_free_gb: Number(rawSystem.disk_free_gb) || 50.0,
      gpus: Array.isArray(rawSystem.gpus) ? rawSystem.gpus : [],
      warnings: Array.isArray(rawSystem.warnings) ? rawSystem.warnings : [],
    };
  }

  private buildNodeFallbackSystem(): SystemHardwareSnapshot {
    const totalRam = Math.round((os.totalmem() / 1024 ** 3) * 100) / 100;
    const freeRam = Math.round((os.freemem() / 1024 ** 3) * 100) / 100;
    return {
      os_name: os.type(),
      architecture: os.arch(),
      cpu_physical: os.cpus().length,
      cpu_logical: os.cpus().length,
      ram_total_gb: totalRam,
      ram_available_gb: freeRam,
      disk_free_gb: 50.0,
      gpus: [],
      warnings: ["Native Node.js system snapshot used (Python service was unreachable)"],
    };
  }
}
