import { z } from "zod";

export const UserInputSubmissionSchema = z.object({
  inputType: z.string().min(1, "inputType is required"),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UserInputSubmission = z.infer<typeof UserInputSubmissionSchema>;

export interface GenericUserInputResult {
  success: boolean;
  step: string;
  data: Record<string, unknown>;
}
