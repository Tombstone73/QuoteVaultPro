import { z } from "zod";
import {
  bugAiReviewResultSchema,
  type BugAiReviewResult,
} from "@shared/aiReviewContracts";

export interface BugReviewValidationResult {
  success: boolean;
  result?: BugAiReviewResult;
  errors?: Array<{ path: string; message: string }>;
}

function zodIssuesToErrors(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validateBugReviewJson(value: unknown): BugReviewValidationResult {
  const parsed = bugAiReviewResultSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false, errors: zodIssuesToErrors(parsed.error) };
  }
  return { success: true, result: parsed.data };
}

export function parseAiJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response did not contain a JSON object.");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
