import { Router } from "express";
import { DomainController } from "../controllers/domain.controller";

export default function createDomainRouter(controller: DomainController): Router {
  const router = Router();
  router.get("/", controller.getDomains);
  return router;
}
