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
