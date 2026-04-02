/**
 * app/api/auth/token/route.ts
 *
 * POST /api/auth/token
 *
 * Generate a JWT for a user or admin. In production, this endpoint requires
 * the request to include the ADMIN_SECRET header to create admin tokens.
 *
 * Request body:
 * {
 *   "userId": "alice",
 *   "role": "user" | "admin",
 *   "adminSecret": "..."    // required when role === "admin"
 * }
 *
 * Success (200):
 * {
 *   "token": "<jwt>",
 *   "expiresAt": "<iso timestamp>",
 *   "userId": "alice",
 *   "role": "user"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { signToken, JWT_EXPIRY } from "@/lib/auth-middleware";
import { logSuccess, logDenied } from "@/lib/audit-logger";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { userId?: string; role?: string; adminSecret?: string };

  try {
    body = (await req.json()) as typeof body;
import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/auth-middleware";
import type { AuthContext } from "@/lib/types";

/**
 * POST /api/auth/token
 *
 * Generate a signed JWT token for use with agent endpoints.
 * In production this endpoint should itself be protected by admin credentials.
 *
 * Request body:
 * {
 *   "userId": "user-123",
 *   "email": "admin@example.com",
 *   "role": "admin"        // "user" | "admin" | "service"
 * }
 *
 * Success response (200):
 * { "token": "eyJ..." }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<{ token: string } | { error: string }>> {
  let body: Partial<AuthContext>;

  try {
    body = (await req.json()) as Partial<AuthContext>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, role, adminSecret } = body;

  if (!userId || typeof userId !== "string" || !userId.trim()) {
  if (!body.userId) {
    return NextResponse.json(
      { error: "Missing required field: userId" },
      { status: 400 }
    );
  }

  if (role !== "user" && role !== "admin") {
    return NextResponse.json(
      { error: "Field 'role' must be 'user' or 'admin'" },
      { status: 400 }
    );
  }

  // Admin tokens require the admin secret
  if (role === "admin") {
    if (!ADMIN_SECRET) {
      return NextResponse.json(
        { error: "Admin token generation is disabled (ADMIN_SECRET not configured)" },
        { status: 503 }
      );
    }
    if (adminSecret !== ADMIN_SECRET) {
      logDenied("auth.token_issued", userId, "admin", {
        metadata: { reason: "invalid admin secret" },
      });
      return NextResponse.json(
        { error: "Invalid admin secret" },
        { status: 403 }
      );
    }
  }

  try {
    // Calculate expiry time from the JWT_EXPIRY setting
    const expiresAt = resolveExpiry(JWT_EXPIRY);
    const token = await signToken({ userId: userId.trim(), role });

    logSuccess("auth.token_issued", userId, role, {
      metadata: { expiry: JWT_EXPIRY },
    });

    return NextResponse.json({ token, expiresAt, userId, role });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Parse a jose-style expiry string (e.g. "8h", "1d", "30m") and return an ISO timestamp.
 */
function resolveExpiry(expiry: string): string {
  const match = /^(\d+)([smhd])$/.exec(expiry);
  if (!match) return "";
  const [, amount, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const ms = parseInt(amount, 10) * (multipliers[unit] ?? 0);
  return new Date(Date.now() + ms).toISOString();
  const validRoles: AuthContext["role"][] = ["user", "admin", "service"];
  const role: AuthContext["role"] =
    body.role && validRoles.includes(body.role) ? body.role : "user";

  const token = await signToken({
    sub: body.userId,
    userId: body.userId,
    email: body.email ?? "",
    role,
    permissions: body.permissions ?? [],
  });

  return NextResponse.json({ token });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "Auth Token API",
    version: "1.0.0",
    description: "Generates JWT tokens for API authentication",
    usage: "POST /api/auth/token with { userId, role, adminSecret? }",
    description: "Generate JWT tokens for authenticating against agent endpoints",
    usage:
      "POST /api/auth/token with { userId, email?, role? }",
  });
}
