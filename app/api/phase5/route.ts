import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  runFullAgentPipeline,
  reportExecutionSummary,
} from "@/lib/phase5-orchestrator";
import type { Phase5Request, Phase5Response } from "@/lib/types";

/**
 * POST /api/phase5
 *
 * End-to-end autonomous agent demo endpoint.  Accepts a natural-language
 * prompt and orchestrates the full pipeline:
 *   1. Permission check
 *   2. Rate limit enforcement
 *   3. AI planning  (/api/ai)
 *   4. File execution with auto-correction  (/api/agent)
 *   5. Output validation and audit logging
 *
 * Request body:
 * {
 *   "prompt": "Create a product catalog dashboard with CRUD and search",
 *   "userId": "demo-user",         // optional
 *   "role": "user"                 // optional — "admin" | "user" | "readonly"
 * }
 *
 * Success response (200):
 * {
 *   "success": true,
 *   "executionId": "exec-abc123",
 *   "filesCreated": [...],
 *   "duration": 8500,
 *   "tokensUsed": 12400,
 *   "corrections": 2,
 *   "auditEvents": [...]
 * }
 *
 * Error responses:
 *   400 — missing / invalid body
 *   429 — rate limit exceeded (Retry-After header set)
 *   500 — pipeline error
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<Phase5Response | { error: string }>> {
  let body: Phase5Request;

  try {
    body = (await req.json()) as Phase5Request;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json(
      { error: "Missing required field: prompt" },
      { status: 400 }
    );
  }

  const userId = body.userId ?? "anonymous";
  const role = body.role ?? "user";

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) },
      }
    );
  }

  // ── Run pipeline ───────────────────────────────────────────────────────────
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const execution = await runFullAgentPipeline(body.prompt, {
      userId,
      role,
      baseUrl,
    });

    const response = reportExecutionSummary(execution);

    if (!execution.success && execution.error) {
      // Permission denied or critical failure
      const statusCode = execution.error.includes("permission") ? 403 : 500;
      return NextResponse.json(response, { status: statusCode });
    }

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[api/phase5] Unhandled error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "Phase 5 Demo API",
    version: "1.0.0",
    description:
      "End-to-end autonomous agent demo: AI planning + code execution + validation",
    usage:
      "POST /api/phase5 with { prompt: string, userId?: string, role?: 'admin' | 'user' | 'readonly' }",
    enabled: process.env.PHASE5_DEMO_ENABLED !== "false",
  });
}
