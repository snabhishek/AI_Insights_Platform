import { Router } from "express";
import { UserInputController } from "../controllers/userInput.controller";

export default function createUserInputRouter(controller: UserInputController): Router {
  const router = Router();

  router.post("/", controller.submitInput);
  router.get("/:projectId", controller.getInputs);

  return router;
}
