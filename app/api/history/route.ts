/**
 * app/api/history/route.ts
 *
 * GET  /api/history          — List execution records (requires auth)
 * GET  /api/history?id=<id>  — Get single record
 * POST /api/history/<id>/rollback — Rollback (admin only, via body action)
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAuthContext } from "@/lib/auth-middleware";
import { listRecords, getRecord, rollbackExecution } from "@/lib/execution-history";
import { logDenied, logSuccess } from "@/lib/audit-logger";
import type { ExecutionRecord, ExecutionStatus } from "@/lib/types";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Require authentication
  const authResult = await extractAuthContext(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }
  const auth = authResult.auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  // Single record lookup
  if (id) {
    const record = getRecord(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    // Users can only view their own records; admins can view all
    if (auth.role !== "admin" && record.userId !== auth.userId) {
      logDenied("permission.denied", auth.userId, auth.role, {
        resource: `history/${id}`,
        action: "read",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(record);
  }

  // List records
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
  const offset = Number(searchParams.get("offset") ?? "0");
  const type = searchParams.get("type") as ExecutionRecord["type"] | null;
  const status = searchParams.get("status") as ExecutionStatus | null;

  // Non-admins can only see their own records
  const userId = auth.role === "admin"
    ? (searchParams.get("userId") ?? undefined)
    : auth.userId;

  const result = listRecords({
    userId: userId ?? undefined,
    type: type ?? undefined,
    status: status ?? undefined,
    limit,
    offset,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Require admin for rollback
  const authResult = await extractAuthContext(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }
  const auth = authResult.auth;
  if (auth.role !== "admin") {
    logDenied("permission.denied", auth.userId, auth.role, {
      resource: "history/rollback",
      action: "execute",
    });
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let body: { id?: string; action?: string };
  try {
    body = (await req.json()) as typeof body;
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

  if (!body.id || body.action !== "rollback") {
    return NextResponse.json(
      { error: "Request body must contain { id, action: 'rollback' }" },
  if (!body.executionId) {
    return NextResponse.json(
      { error: "Missing required field: executionId" },
      { status: 400 }
    );
  }

  const result = await rollbackExecution(body.id);

  if (result.success) {
    logSuccess("agent.execute", auth.userId, auth.role, {
      resource: `history/${body.id}`,
      action: "rollback",
      metadata: { filesRestored: result.filesRestored },
    });
  }

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
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
