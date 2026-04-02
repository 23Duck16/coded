import Anthropic from "@anthropic-ai/sdk";
import type {
  AiPlanStep,
  CorrectionRequest,
  CorrectionResponse,
  DiagnosticError,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? "claude-3-5-sonnet-20241022";

const CORRECTION_SYSTEM_PROMPT = `You are an expert at debugging and fixing generated code.

You receive:
1. Original workflow steps that were executed
2. Errors that occurred (TypeScript, ESLint, runtime)
3. Current repository structure
4. Attempt number (how many retries we've done)

Your job: analyze the errors and suggest corrected steps that will fix the issues.

For each error:
- Identify the root cause
- Suggest the minimal fix
- Explain why it will work

Be conservative: if you're unsure, suggest rolling back rather than guessing.

You MUST return valid JSON in exactly this shape and nothing else:
{
  "correctedSteps": [
    {
      "name": "string — short human-readable step title",
      "action": "apply_template | create_file | update_file | multi_step",
      "template": "optional — template id",
      "path": "optional — file path relative to repo root",
      "content": "optional — file content for create_file / update_file",
      "params": { "key": "value" }
    }
  ],
  "explanation": "string — what was wrong and how you fixed it",
  "confidence": 0.0,
  "shouldRetry": true
}

Rules:
- confidence is a number between 0 and 1
- shouldRetry must be false if you have no remaining good options
- Keep correctedSteps minimal — only include steps that need to change`;

const VALID_ACTIONS = new Set<AiPlanStep["action"]>([
  "apply_template",
  "create_file",
  "update_file",
  "multi_step",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatErrors(errors: DiagnosticError[]): string {
  return errors
    .map(
      (e) =>
        `[${e.source.toUpperCase()}] ${e.file}${e.line ? `:${e.line}` : ""}` +
        `${e.code ? ` (${e.code})` : ""}: ${e.message}` +
        (e.suggestion ? `\n  Suggestion: ${e.suggestion}` : "")
    )
    .join("\n");
}

function buildCorrectionMessage(req: CorrectionRequest): string {
  return [
    `Attempt ${req.attemptNumber} of ${req.maxAttempts}.`,
    "",
    "=== Original Steps ===",
    JSON.stringify(req.originalSteps, null, 2),
    "",
    "=== Errors Encountered ===",
    formatErrors(req.errors),
    "",
    "=== Repository Context ===",
    JSON.stringify(req.context, null, 2),
  ].join("\n");
}

function parseCorrectionResponse(raw: string): CorrectionResponse {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude correction response does not contain a JSON object");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    correctedSteps?: unknown;
    explanation?: unknown;
    confidence?: unknown;
    shouldRetry?: unknown;
  };

  if (!Array.isArray(parsed.correctedSteps)) {
    throw new Error("Correction response missing 'correctedSteps' array");
  }

  const correctedSteps: AiPlanStep[] = [];
  for (const s of parsed.correctedSteps as unknown[]) {
    const step = s as Record<string, unknown>;
    const action = step.action as string | undefined;
    if (!action || !VALID_ACTIONS.has(action as AiPlanStep["action"])) {
      console.warn(
        `[ai-corrections] Skipping step with unrecognized action '${String(action)}'`
      );
      continue;
    }
    correctedSteps.push({
      name: String(step.name ?? ""),
      action: action as AiPlanStep["action"],
      template:
        step.template !== undefined ? String(step.template) : undefined,
      path: step.path !== undefined ? String(step.path) : undefined,
      content:
        step.content !== undefined ? String(step.content) : undefined,
      params:
        step.params !== null &&
        typeof step.params === "object" &&
        !Array.isArray(step.params)
          ? (step.params as Record<string, string>)
          : undefined,
    });
  }

  const rawConfidence = Number(parsed.confidence ?? 0);
  const confidence = isNaN(rawConfidence)
    ? 0
    : Math.max(0, Math.min(1, rawConfidence));

  return {
    correctedSteps,
    explanation: String(parsed.explanation ?? ""),
    confidence,
    shouldRetry: Boolean(parsed.shouldRetry ?? false),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send the original workflow steps and the errors they produced to Claude and
 * return corrected steps for the next retry attempt.
 *
 * Throws if `ANTHROPIC_API_KEY` is not set or the API call fails.
 */
export async function requestCorrection(
  req: CorrectionRequest
): Promise<CorrectionResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env.local file."
    );
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: CORRECTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildCorrectionMessage(req) }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude API");
  }

  return parseCorrectionResponse(content.text);
}
