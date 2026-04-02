import { NextRequest, NextResponse } from "next/server";
import { requestCorrection } from "@/lib/ai-corrections";
import { executeSteps, rollbackTransaction, getTransactionHistory } from "@/lib/execution-manager";
import { analyzeRepo } from "@/lib/codebase-analyzer";
import type {
  AiPlanStep,
  CorrectionRecord,
  DiagnosticError,
  ExecuteRequest,
  ExecuteResponse,
} from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
/** Hard upper limit on the number of retries regardless of caller preference. */
const MAX_RETRY_LIMIT = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msToHuman(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * POST /api/execute
 *
 * Accepts workflow steps (typically from /api/ai), executes them, runs
 * TypeScript checks, and — when `autoRetry` is true — asks Claude to correct
 * errors and retries up to `maxRetries` times before giving up.
 *
 * Request body:
 * {
 *   "steps": [ { "name": "...", "action": "...", ... } ],
 *   "autoRetry": true,
 *   "maxRetries": 3,
 *   "dryRun": false
 * }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<ExecuteResponse | { error: string }>> {
  let body: ExecuteRequest;

  try {
    body = (await req.json()) as ExecuteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json(
      { error: "Missing or empty 'steps' array" },
      { status: 400 }
    );
  }

  const autoRetry = body.autoRetry ?? true;
  const maxRetries = Math.min(body.maxRetries ?? DEFAULT_MAX_RETRIES, MAX_RETRY_LIMIT);
  const dryRun = body.dryRun ?? false;

  const globalStart = Date.now();
  const corrections: CorrectionRecord[] = [];
  let currentSteps: AiPlanStep[] = body.steps;
  let lastErrors: DiagnosticError[] = [];
  let lastTransactionId: string | undefined;

  // Fetch repo context once for any correction requests
  let repoContext: Record<string, unknown> = {};
  try {
    const structure = await analyzeRepo();
    repoContext = structure as unknown as Record<string, unknown>;
  } catch {
    // Non-fatal — proceed without context
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isRetry = attempt > 0;
    if (isRetry) {
      console.log(`[api/execute] Retry attempt ${attempt}/${maxRetries}`);
    }

    // ── Execute the current step list ────────────────────────────────────────
    const result = await executeSteps(currentSteps, { dryRun });
    lastTransactionId = result.transactionId;

    if (result.success) {
      // ── Success ────────────────────────────────────────────────────────────
      return NextResponse.json(
        {
          success: true,
          filesCreated: result.filesCreated,
          errors: [],
          autoFixed: corrections.length > 0,
          executionTime: msToHuman(Date.now() - globalStart),
          corrections: corrections.length > 0 ? corrections : undefined,
          transactionId: lastTransactionId,
        } satisfies ExecuteResponse,
        { status: 200 }
      );
    }

    // ── Failure path ──────────────────────────────────────────────────────────
    lastErrors = result.errors;

    // Roll back any partial writes from this attempt
    if (lastTransactionId) {
      const history = getTransactionHistory();
      const tx = history.find((t) => t.id === lastTransactionId);
      if (tx) {
        await rollbackTransaction(tx);
      }
    }

    // No more retries or autoRetry disabled → bail out
    if (!autoRetry || attempt >= maxRetries) {
      break;
    }

    // ── Ask Claude for corrected steps ────────────────────────────────────────
    let correctionResponse;
    try {
      correctionResponse = await requestCorrection({
        originalSteps: currentSteps,
        errors: lastErrors,
        attemptNumber: attempt + 1,
        maxAttempts: maxRetries,
        context: repoContext,
      });
    } catch (corrErr) {
      const msg =
        corrErr instanceof Error ? corrErr.message : String(corrErr);
      console.warn(`[api/execute] Correction request failed: ${msg}`);
      break;
    }

    if (!correctionResponse.shouldRetry || correctionResponse.correctedSteps.length === 0) {
      console.log(
        "[api/execute] Claude decided not to retry (confidence: " +
          correctionResponse.confidence.toFixed(2) +
          ")"
      );
      break;
    }

    // Record what was corrected for the audit trail
    corrections.push({
      originalStep: currentSteps.map((s) => s.name).join(", "),
      issue: lastErrors.map((e) => e.message).join("; "),
      correction: correctionResponse.explanation,
      retryAttempt: attempt + 1,
    });

    currentSteps = correctionResponse.correctedSteps;
  }

  // ── All attempts exhausted — return failure ───────────────────────────────
  return NextResponse.json(
    {
      success: false,
      filesCreated: [],
      errors: lastErrors,
      autoFixed: corrections.length > 0,
      executionTime: msToHuman(Date.now() - globalStart),
      corrections: corrections.length > 0 ? corrections : undefined,
    } satisfies ExecuteResponse,
    { status: 422 }
  );
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "Execute API",
    version: "1.0.0",
    description:
      "Executes CodeSpring workflow steps with TypeScript validation and auto-retry via Claude",
    usage:
      "POST /api/execute with { steps: AiPlanStep[], autoRetry?: boolean, maxRetries?: number, dryRun?: boolean }",
    features: [
      "TypeScript compilation checking before committing files",
      "Auto-retry with Claude-powered error correction",
      "Transaction rollback on failure",
      "Audit trail of all correction attempts",
    ],
  });
}
