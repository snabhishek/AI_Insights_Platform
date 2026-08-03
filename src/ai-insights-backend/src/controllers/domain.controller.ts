import { Request, Response } from "express";
import { DomainService } from "../services/domain/domain.service";

export class DomainController {
  constructor(private domainService: DomainService) {}

  getDomains = async (req: Request, res: Response): Promise<void> => {
    try {
      const domains = await this.domainService.getDomains();
      res.json(domains);
    } catch (err: any) {
      console.error("[DomainController] Failed to fetch domains:", err);
      res.status(500).json({ error: "Failed to fetch domains", message: err.message || String(err) });
    }
  };
}
