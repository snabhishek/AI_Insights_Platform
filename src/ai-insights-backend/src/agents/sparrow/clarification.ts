import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SparrowInteraction } from "./types";

export const CLARIFICATION_WINDOW_MS = 100_000;
export const clarificationSchema = z.object({
  question: z.string().trim().min(1),
  missingField: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).optional(),
});

export function createClarificationInteraction(now = Date.now()): SparrowInteraction {
  return { id: randomUUID(), requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CLARIFICATION_WINDOW_MS).toISOString(), status: "waiting" };
}

export function interactionAt(interaction: SparrowInteraction, now = Date.now()): SparrowInteraction {
  return { ...interaction, status: interaction.status === "answered" ? "answered"
    : now >= Date.parse(interaction.expiresAt) ? "timed_out" : "waiting" };
}
