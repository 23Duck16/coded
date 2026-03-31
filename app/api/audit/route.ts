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
}
