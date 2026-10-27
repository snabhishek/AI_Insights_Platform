import { Request, Response } from "express";
import { IConfigService } from "../services/config/config.service.interface";

export class ConfigController {
  constructor(private configService: IConfigService) {}

  public getConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = await this.configService.getCurrentConfig();
      res.status(200).json({ success: true, data: config });
    } catch (err: any) {
      console.error("[ConfigController] Error getting config:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to retrieve configuration" });
    }
  };

  public discoverModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, apiKey, apiBase, apiVersion } = req.body || {};
      if (!provider) {
        res.status(400).json({ success: false, error: "Provider is required for model discovery" });
        return;
      }
      const result = await this.configService.discoverModels(provider, apiKey, apiBase, apiVersion);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error("[ConfigController] Error discovering models:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to discover models" });
    }
  };

  public saveProvider = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = req.body || {};
      const result = await this.configService.saveProviderConfig(payload);
      if (!result.success) {
        res.status(400).json({ success: false, error: result.message, data: result });
        return;
      }
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err: any) {
      console.error("[ConfigController] Error saving provider config:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to configure provider" });
    }
  };

  public testConnection = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = req.body || {};
      const result = await this.configService.testProviderConfig(payload);
      if (!result.success) {
        res.status(400).json({ success: false, error: result.message, data: result });
        return;
      }
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error("[ConfigController] Error testing connection:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to test connection" });
    }
  };

  public deleteModel = async (req: Request, res: Response): Promise<void> => {
    try {
      const rawId = req.params.id;
      const modelId = Array.isArray(rawId) ? rawId[0] : String(rawId || "");
      const result = await this.configService.deleteModelFromLiteLLM(modelId);
      res.status(200).json(result);
    } catch (err: any) {
      console.error("[ConfigController] Error deleting model:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to delete model" });
    }
  };

  public setActiveModel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { modelName } = req.body || {};
      if (!modelName) {
        res.status(400).json({ success: false, error: "modelName is required" });
        return;
      }
      const result = await this.configService.setActiveModel(modelName);
      if (!result.success) {
        res.status(400).json({ success: false, error: result.message });
        return;
      }
      res.status(200).json(result);
    } catch (err: any) {
      console.error("[ConfigController] Error setting active model:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to set active model" });
    }
  };
}
