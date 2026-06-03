import { z } from "zod";
import {
  aiTriageBriefResultSchema,
  type AiTriageBriefResult,
} from "@shared/aiTriageBriefContracts";

export interface TriageBriefValidationResult {
  success: boolean;
  result?: AiTriageBriefResult;
  errors?: Array<{ path: string; message: string }>;
}

function zodIssuesToErrors(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validateTriageBriefJson(value: unknown): TriageBriefValidationResult {
  const parsed = aiTriageBriefResultSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false, errors: zodIssuesToErrors(parsed.error) };
  }
  return { success: true, result: parsed.data };
}
