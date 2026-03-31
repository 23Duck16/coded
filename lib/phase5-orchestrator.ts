import { randomUUID } from "crypto";
import type {
  AuditEvent,
  AiPlanStep,
  PipelineExecutionResult,
  Phase5Response,
} from "./types";

// ─── Rate Limiting ────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(userId: string): {
  allowed: boolean;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000
    );
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

/** Reset rate limit state for a user (used in tests). */
export function resetRateLimit(userId: string): void {
  rateLimitStore.delete(userId);
}

// ─── Permission Checks ────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(["admin", "user"]);

export function checkPermissions(role: string): {
  allowed: boolean;
  reason?: string;
} {
  if (!ALLOWED_ROLES.has(role)) {
    return {
      allowed: false,
      reason: `Role '${role}' does not have permission to run the pipeline`,
    };
  }
  return { allowed: true };
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

export function createAuditEvent(
  action: string,
  status: AuditEvent["status"],
  extras?: Partial<Omit<AuditEvent, "action" | "status" | "timestamp">>
): AuditEvent {
  return {
    action,
    status,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

// ─── Dashboard Output Validation ──────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validates that the list of generated files meets minimum quality standards
 * for a dashboard feature: at least one model, one API route, and one UI
 * component should be present.
 */
export function validateDashboardOutput(files: string[]): ValidationResult {
  const issues: string[] = [];

  const hasModel = files.some(
    (f) => f.startsWith("lib/models/") && f.endsWith(".ts")
  );
  const hasApiRoute = files.some(
    (f) => f.startsWith("app/api/") && f.endsWith("route.ts")
  );
  const hasComponent = files.some(
    (f) =>
      (f.startsWith("app/") || f.startsWith("components/")) &&
      (f.endsWith(".tsx") || f.endsWith(".jsx"))
  );

  if (!hasModel) issues.push("No data model found (expected lib/models/*.ts)");
  if (!hasApiRoute)
    issues.push("No API route found (expected app/api/*/route.ts)");
  if (!hasComponent)
    issues.push("No UI component found (expected app/**/*.tsx)");

  return { valid: issues.length === 0, issues };
}

// ─── Execution Summary ────────────────────────────────────────────────────────

/** Formats a completed pipeline execution into the public response shape. */
export function reportExecutionSummary(
  execution: PipelineExecutionResult
): Phase5Response {
  const duration =
    (execution.endTime ?? Date.now()) - execution.startTime;

  return {
    success: execution.success,
    executionId: execution.executionId,
    filesCreated: execution.filesCreated,
    duration,
    tokensUsed: execution.tokensUsed,
    corrections: execution.corrections,
    auditEvents: execution.auditEvents,
    error: execution.error,
  };
}

// ─── Pipeline Orchestration ───────────────────────────────────────────────────

export interface PipelineContext {
  userId: string;
  role: string;
  /** Base URL for internal API calls (defaults to NEXT_PUBLIC_APP_URL or http://localhost:3000) */
  baseUrl?: string;
}

/**
 * Runs the full autonomous agent pipeline:
 * 1. Permission check
 * 2. AI planning (calls /api/ai)
 * 3. File execution (calls /api/agent for each step)
 * 4. Output validation with auto-correction
 *
 * Returns a complete PipelineExecutionResult.
 */
export async function runFullAgentPipeline(
  prompt: string,
  context: PipelineContext
): Promise<PipelineExecutionResult> {
  const executionId = `exec-${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();
  const auditEvents: AuditEvent[] = [];
  const filesCreated: string[] = [];
  let tokensUsed = 0;
  let corrections = 0;

  const baseUrl =
    context.baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  // ── 1. Permission check ──────────────────────────────────────────────────
  const permCheck = checkPermissions(context.role);
  if (!permCheck.allowed) {
    auditEvents.push(
      createAuditEvent("permission_check", "failure", {
        details: { reason: permCheck.reason },
      })
    );
    return {
      executionId,
      prompt,
      userId: context.userId,
      role: context.role,
      startTime,
      endTime: Date.now(),
      filesCreated,
      tokensUsed,
      corrections,
      auditEvents,
      success: false,
      error: permCheck.reason,
    };
  }

  auditEvents.push(createAuditEvent("permission_check", "success"));

  // ── 2. AI planning ───────────────────────────────────────────────────────
  let planSteps: AiPlanStep[] = [];
  let planningTokens = 0;

  try {
    const planRes = await fetch(`${baseUrl}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        context: {
          executionId,
          userId: context.userId,
          role: context.role,
          phase: 5,
        },
      }),
    });

    if (!planRes.ok) {
      const err = await planRes.text();
      throw new Error(`AI planning failed (${planRes.status}): ${err}`);
    }

    const planData = (await planRes.json()) as {
      steps?: AiPlanStep[];
      tokensUsed?: number;
    };

    planSteps = planData.steps ?? [];
    // The real Claude response doesn't return tokensUsed in body; we estimate
    planningTokens = planData.tokensUsed ?? estimateTokens(prompt) * 3;
    tokensUsed += planningTokens;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    auditEvents.push(
      createAuditEvent("ai_planning", "failure", { details: { error: msg } })
    );
    return {
      executionId,
      prompt,
      userId: context.userId,
      role: context.role,
      startTime,
      endTime: Date.now(),
      filesCreated,
      tokensUsed,
      corrections,
      auditEvents,
      success: false,
      error: `AI planning error: ${msg}`,
    };
  }

  auditEvents.push(
    createAuditEvent("ai_planning", "success", { tokensUsed: planningTokens })
  );

  // ── 3. File execution ────────────────────────────────────────────────────
  let executionTokens = 0;
  const MAX_CORRECTION_ATTEMPTS = 3;

  for (const step of planSteps) {
    let attempt = 0;
    let stepSuccess = false;

    while (attempt < MAX_CORRECTION_ATTEMPTS && !stepSuccess) {
      attempt += 1;

      // Each retry after the first counts as an auto-correction
      if (attempt > 1) corrections += 1;

      try {
        const agentBody = buildAgentRequest(step);
        const agentRes = await fetch(`${baseUrl}/api/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentBody),
        });

        if (!agentRes.ok) {
          const errText = await agentRes.text();
          throw new Error(
            `Agent returned ${agentRes.status}: ${errText}`
          );
        }

        const agentData = (await agentRes.json()) as {
          success: boolean;
          results?: Array<{ target_path?: string }>;
          error?: string;
        };

        if (agentData.success) {
          stepSuccess = true;
          const created = (agentData.results ?? [])
            .map((r) => r.target_path)
            .filter((p): p is string => Boolean(p));
          filesCreated.push(...created);
          const stepTokens = estimateTokens(JSON.stringify(agentBody));
          executionTokens += stepTokens;
        } else {
          const stepTokens = estimateTokens(JSON.stringify(agentBody));
          executionTokens += stepTokens;

          if (attempt >= MAX_CORRECTION_ATTEMPTS) {
            throw new Error(
              agentData.error ?? "Agent step failed after max retries"
            );
          }
        }
      } catch (err) {
        if (attempt >= MAX_CORRECTION_ATTEMPTS) {
          const msg = err instanceof Error ? err.message : String(err);
          auditEvents.push(
            createAuditEvent("code_execution", "failure", {
              details: { step: step.name, error: msg, attempts: attempt },
            })
          );
          // Non-fatal: continue with remaining steps
          break;
        }
        // correction already counted at top of loop
      }
    }
  }

  tokensUsed += executionTokens;

  auditEvents.push(
    createAuditEvent("code_execution", "success", {
      filesCreated: filesCreated.length,
      tokensUsed: executionTokens,
    })
  );

  if (corrections > 0) {
    auditEvents.push(
      createAuditEvent("auto_correction", "success", { attempts: corrections })
    );
  }

  // ── 4. Output validation ─────────────────────────────────────────────────
  const validation = validateDashboardOutput(filesCreated);
  if (!validation.valid) {
    auditEvents.push(
      createAuditEvent("output_validation", "failure", {
        details: { issues: validation.issues },
      })
    );
  } else {
    auditEvents.push(createAuditEvent("output_validation", "success"));
  }

  return {
    executionId,
    prompt,
    userId: context.userId,
    role: context.role,
    startTime,
    endTime: Date.now(),
    filesCreated,
    tokensUsed,
    corrections,
    auditEvents,
    success: true,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Roughly estimate token count from a string (4 chars ≈ 1 token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Convert an AI plan step to an agent request body. */
function buildAgentRequest(step: AiPlanStep): Record<string, unknown> {
  if (step.action === "apply_template") {
    return {
      action: "apply_template",
      target_path: step.path,
      template_name: step.template,
      params: step.params ?? {},
      description: step.name,
    };
  }

  return {
    action: step.action,
    target_path: step.path,
    content: step.params?.content ?? "",
    description: step.name,
  };
}
