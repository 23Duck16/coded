/**
 * app/api/audit/route.ts
 *
 * GET /api/audit — Read recent audit events (admin only)
 *
 * Query params:
 *   limit  — max events to return (default 50, max 200)
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAuthContext } from "@/lib/auth-middleware";
import { readRecentEvents, logDenied } from "@/lib/audit-logger";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await extractAuthContext(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }
  const auth = authResult.auth;
  if (auth.role !== "admin") {
    logDenied("permission.denied", auth.userId, auth.role, {
      resource: "audit",
      action: "read",
    });
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const events = readRecentEvents(limit);
  return NextResponse.json({ events, total: events.length });
import { NextRequest, NextResponse } from "next/server";
import { extractAuth } from "@/lib/auth-middleware";
import { getAuditLog, getExecutionStats } from "@/lib/audit-logger";

/**
 * GET /api/audit
 *
 * Query params:
 *   - userId    (optional) — filter by user; defaults to the authenticated user
 *   - startDate (optional) — ISO 8601 date string
 *   - endDate   (optional) — ISO 8601 date string
 *   - limit     (optional, default 100)
 *   - stats     ("true") — return execution stats instead of events
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
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
  const userId = searchParams.get("userId") ?? auth?.userId ?? "anonymous";
  const limit = Number(searchParams.get("limit") ?? "100");
  const statsOnly = searchParams.get("stats") === "true";
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");

  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;

  try {
    if (statsOnly) {
      const stats = await getExecutionStats(userId);
      return NextResponse.json(stats);
    }

    const events = await getAuditLog(userId, startDate, endDate, limit);
    return NextResponse.json(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
