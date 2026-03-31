import { NextRequest, NextResponse } from "next/server";
import { planWithClaude } from "@/lib/ai";
import { analyzeRepo } from "@/lib/codebase-analyzer";
import type { AiRequest, AiResponse } from "@/lib/types";

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
    // Attach any dauthContext that was passed through for demo tracking (Phase 5)
    const response: AiResponse = body.context?.executionId
      ? {
          ...result,
          dauthContext: {
            executionId: body.context.executionId,
            userId: body.context.userId,
            role: body.context.role,
            phase: body.context.phase,
          },
        }
      : result;
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[api/ai] Error:", err);

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
