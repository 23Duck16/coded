import { NextRequest, NextResponse } from "next/server";
import { planWithClaude } from "@/lib/ai";
import { analyzeRepo } from "@/lib/codebase-analyzer";
import { extractAuth } from "@/lib/auth-middleware";
import { checkRateLimit, consumeTokens, defaultLimitConfig } from "@/lib/rate-limiter";
import { logEvent } from "@/lib/audit-logger";
import type { AiRequest, AiResponse } from "@/lib/types";

/** Rough token estimate per step when actual usage is not returned by the API */
const TOKENS_PER_STEP_ESTIMATE = 50;

/**
 * POST /api/ai
 *
 * Accepts a natural-language prompt and optional context, calls Claude to
 * decompose the request into ordered CodeSpring workflow steps, and returns
 * a structured plan.
 *
 * Request body:
 * {
 *   "prompt": "Create a reports dashboard with user metrics and export to CSV",
 *   "context": { "existingModels": ["User", "Case"], "targetPath": "app/reports" },
 *   "model": "claude"   // optional — only "claude" is supported right now
 * }
 *
 * Success response (200):
 * {
 *   "steps": [ { "name": "...", "action": "...", ... }, ... ],
 *   "reasoning": "...",
 *   "estimatedTime": "~5 min"
 * }
 *
 * Error response (4xx / 5xx):
 * { "error": "message" }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<AiResponse | { error: string }>> {
  const startTime = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  let auth;
  try {
    auth = await extractAuth(req, { requireAuth: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 }
    );
  }
  const userId = auth?.userId ?? "anonymous";

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rateLimitStatus = await checkRateLimit(userId, defaultLimitConfig);
  if (!rateLimitStatus.allowed) {
    await logEvent({
      userId,
      action: "ai_planning",
      resource: "/api/ai",
      status: "failure",
      details: { reason: "Rate limit exceeded" },
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "X-RateLimit-Reset": rateLimitStatus.resetAt.toISOString() },
      }
    );
  }

  let body: AiRequest;

  try {
    body = (await req.json()) as AiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json(
      { error: "Missing required field: prompt" },
      { status: 400 }
    );
  }

  if (body.model && body.model !== "claude" && body.model !== "gpt4") {
    return NextResponse.json(
      { error: "Unsupported model. Supported values: 'claude', 'gpt4'" },
      { status: 400 }
    );
  }

  // Inject live repo structure into the context so Claude can make
  // conflict-aware, pattern-consistent decisions.
  let enrichedContext: Record<string, unknown> = body.context ?? {};
  try {
    const repoStructure = await analyzeRepo();
    enrichedContext = {
      ...enrichedContext,
      repoStructure,
    };
  } catch (analyzeErr) {
    // Non-fatal — continue without repo context
    console.warn(
      "[api/ai] Could not analyze repo; proceeding without context:",
      analyzeErr instanceof Error ? analyzeErr.message : String(analyzeErr)
    );
  }

  try {
    const result = await planWithClaude({ ...body, context: enrichedContext });

    const duration = Date.now() - startTime;
    const tokensUsed = result.steps?.length ? result.steps.length * TOKENS_PER_STEP_ESTIMATE : 0;
    await consumeTokens(userId, tokensUsed);
    await logEvent({
      userId,
      action: "ai_planning",
      resource: "/api/ai",
      status: result.error ? "failure" : "success",
      details: {
        prompt: body.prompt.slice(0, 200),
        stepsCount: result.steps?.length ?? 0,
      },
      tokensUsed,
      duration,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[api/ai] Error:", err);

    await logEvent({
      userId,
      action: "ai_planning",
      resource: "/api/ai",
      status: "failure",
      details: { error: message },
      duration: Date.now() - startTime,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "AI Planning API",
    version: "1.0.0",
    description:
      "Accepts natural-language prompts and returns structured CodeSpring workflow steps via Claude",
    usage:
      "POST /api/ai with { prompt: string, context?: object, model?: 'claude' | 'gpt4' }",
    supportedModels: ["claude"],
  });
}
