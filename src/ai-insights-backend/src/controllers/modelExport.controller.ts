import { NextFunction, Request, Response } from "express";
import archiver from "archiver";
import { ModelExportError, ModelExportService } from "../services/project/modelExport.service";
import { sanitizeFolderName } from "../config/fileServer.config";

export class ModelExportController {
  constructor(private readonly service: ModelExportService) {}

  public handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId, modelId } = req.params as { projectId: string; modelId: string };
      if (typeof req.query.runTimestamp !== "string") {
        throw new ModelExportError(400, "Run timestamp is required.");
      }
      const exports = await this.service.getExports(projectId, req.query.runTimestamp, modelId);
      if (req.query.format === undefined) {
        res.json({
          formats: exports.map(({ formatId, extension, formatName, filename }) => ({
            formatId,
            extension,
            formatName,
            filename,
          })),
        });
        return;
      }
      if (typeof req.query.format !== "string") throw new ModelExportError(400, "Invalid export format.");
      const selected = req.query.format === "all" ? exports : exports.filter((item) => item.formatId === req.query.format);
      if (selected.length === 0) throw new ModelExportError(404, "No model artifacts available for this format.");
      if (req.query.format !== "all" && selected.length === 1 && !selected[0].isDirectory) {
        res.download(selected[0].absolutePath, selected[0].filename, (error) => {
          if (error) next(error);
        });
        return;
      }
      const files = (await Promise.all(selected.map((item) => this.service.collectFiles(item.modelsRoot, item.absolutePath)))).flat();
      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (error) => res.destroy(error));
      archive.on("warning", (error) => res.destroy(error));
      res.on("close", () => archive.abort());
      res.attachment(`${sanitizeFolderName(modelId)}_${sanitizeFolderName(req.query.format)}.zip`);
      archive.pipe(res);
      for (const file of new Map(files.map((file) => [file.archivePath, file])).values()) {
        archive.file(file.absolutePath, { name: file.archivePath });
      }
      await archive.finalize();
    } catch (error) {
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof ModelExportError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      console.error("[ModelExport] Failed to export model:", error);
      res.status(500).json({ message: "Failed to export model artifacts." });
    }
  };
}
