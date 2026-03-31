import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import type { AgentRequest, AgentResponse } from "@/lib/types";

/**
 * POST /api/agent
 *
 * Accepts a structured JSON instruction and executes it against the repo.
 *
 * Example body:
 * {
 *   "action": "create_file",
 *   "target_path": "app/hello/page.tsx",
 *   "content": "export default function Hello() { return <h1>Hello</h1>; }",
 *   "description": "Add hello page"
 * }
 */
export async function POST(req: NextRequest): Promise<NextResponse<AgentResponse>> {
  let body: AgentRequest;

  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid JSON body",
        results: [],
        error: "Invalid JSON body",
      },
      { status: 400 }
    );
  }

  if (!body.action) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing required field: action",
        results: [],
        error: "Missing required field: action",
      },
      { status: 400 }
    );
  }

  try {
    const result = await runAgent(body);
    const status = result.success ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[api/agent] Unhandled error:", err);
    return NextResponse.json(
      {
        success: false,
        message,
        results: [],
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "Agent API",
    version: "1.0.0",
    description: "Repo-aware agent that reads, writes, and scaffolds files",
    actions: ["create_file", "update_file", "apply_template", "multi_step"],
    usage: "POST /api/agent with a JSON body containing { action, target_path, ... }",
  });
}
