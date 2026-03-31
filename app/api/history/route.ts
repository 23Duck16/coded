import { NextRequest, NextResponse } from "next/server";
import { extractAuth } from "@/lib/auth-middleware";
import {
  listExecutions,
  getExecution,
  rollbackExecution,
  getExecutionStats,
} from "@/lib/execution-history";

/**
 * GET /api/history
 *
 * Query params:
 *   - userId   (optional) — filter by user; defaults to the authenticated user
 *   - limit    (optional, default 50)
 *   - offset   (optional, default 0)
 *   - id       (optional) — get a single execution by id
 *   - stats    (optional) — return stats instead of list ("true")
 *
 * POST /api/history/rollback
 *   Body: { "executionId": "..." }
 */
export async function GET(
  req: NextRequest
): Promise<NextResponse> {
  let auth;
  try {
    auth = await extractAuth(req, { requireAuth: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const executionId = searchParams.get("id");
  const statsOnly = searchParams.get("stats") === "true";
  const userId = searchParams.get("userId") ?? auth?.userId ?? "anonymous";
  const limit = Number(searchParams.get("limit") ?? "50");
  const offset = Number(searchParams.get("offset") ?? "0");

  try {
    if (executionId) {
      const record = await getExecution(executionId);
      return NextResponse.json(record);
    }

    if (statsOnly) {
      const stats = await getExecutionStats(userId);
      return NextResponse.json(stats);
    }

    const executions = await listExecutions(userId, limit, offset);
    return NextResponse.json({ executions, userId, limit, offset });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await extractAuth(req, { requireAuth: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { executionId?: string };
  try {
    body = (await req.json()) as { executionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.executionId) {
    return NextResponse.json(
      { error: "Missing required field: executionId" },
      { status: 400 }
    );
  }

  // Only admins can rollback
  if (auth?.role !== "admin") {
    return NextResponse.json(
      { error: "Admin role required for rollback" },
      { status: 403 }
    );
  }

  try {
    await rollbackExecution(body.executionId);
    return NextResponse.json({ success: true, executionId: body.executionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
