import fs from "fs/promises";
import path from "path";
import { getProjectDir, sanitizeFolderName } from "../../config/fileServer.config";
import { modelExportArtifactSchema } from "../../agents/ModelTrainingValidation/TrainingConfiguration/modelExportContract";
import { ProjectService } from "./project.service";

export class ModelExportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface ModelExportFile {
  absolutePath: string;
  archivePath: string;
}

export class ModelExportService {
  constructor(private readonly projectService: ProjectService) {}

  private async resolveWithin(root: string, target: string): Promise<string> {
    const absolutePath = await fs.realpath(path.resolve(root, target));
    const relativePath = path.relative(root, absolutePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new ModelExportError(400, "Model artifact is outside its allowed directory.");
    }
    return absolutePath;
  }

  public async getExports(projectId: string, runTimestamp: string, modelId: string) {
    if (!runTimestamp || runTimestamp === "." || runTimestamp === ".." || /[\\/\x00]/.test(runTimestamp)) {
      throw new ModelExportError(400, "A valid run timestamp is required.");
    }
    const context = await this.projectService.getProjectWithWorkspace(projectId);
    if (!context) throw new ModelExportError(404, "Project not found.");
    if (!context.project.projectName || !context.workspaceName) {
      throw new ModelExportError(400, "Project and workspace names are required.");
    }
    const projectRoot = await fs.realpath(getProjectDir(context.workspaceName, context.project.projectName));
    const trainingRoot = await this.resolveWithin(projectRoot, path.join(
      runTimestamp, `${sanitizeFolderName(context.project.projectName)}_model_training`
    ));
    const modelsRoot = await this.resolveWithin(trainingRoot, "artifacts/models");
    const reportPath = await this.resolveWithin(trainingRoot, "model_training_report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
    if (!Array.isArray(report.models_evaluated)) {
      throw new ModelExportError(400, "Training report is missing model export results.");
    }
    const model = report.models_evaluated.find((entry: { model_id: string }) => entry.model_id === modelId);
    if (!model) throw new ModelExportError(404, "Model not found in this training run.");
    if (!Array.isArray(model.exports)) {
      throw new ModelExportError(404, "No export artifacts recorded for this model.");
    }
    const artifacts = modelExportArtifactSchema.array().parse(model.exports);
    const resolved = await Promise.all(artifacts.map(async (artifact) => {
      try {
        const absolutePath = await this.resolveWithin(modelsRoot, path.resolve(trainingRoot, artifact.artifact_path));
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile() && !stat.isDirectory()) {
          return null;
        }
        return {
          formatId: artifact.format_id,
          formatName: artifact.format_name || artifact.format_id,
          extension: stat.isDirectory() ? artifact.format_id : path.extname(absolutePath),
          filename: path.basename(absolutePath),
          absolutePath,
          modelsRoot,
          isDirectory: stat.isDirectory(),
        };
      } catch {
        return null;
      }
    }));
    const valid = resolved.filter((item): item is NonNullable<typeof item> => item !== null);
    if (valid.length === 0 && artifacts.length > 0) {
      throw new ModelExportError(404, "Model export files were not found on disk.");
    }
    return valid;
  }

  public async collectFiles(root: string, artifactPath: string): Promise<ModelExportFile[]> {
    if ((await fs.lstat(artifactPath)).isSymbolicLink()) {
      throw new ModelExportError(400, "Symbolic links cannot be included in model exports.");
    }
    const absolutePath = await this.resolveWithin(root, artifactPath);
    const stat = await fs.stat(absolutePath);
    if (stat.isFile()) {
      return [{ absolutePath, archivePath: path.relative(root, absolutePath).split(path.sep).join("/") }];
    }
    if (!stat.isDirectory()) throw new ModelExportError(400, "Invalid model artifact.");
    const entries = await fs.readdir(absolutePath);
    const files = await Promise.all(entries.map((entry) => this.collectFiles(root, path.join(absolutePath, entry))));
    return files.flat();
  }
}
