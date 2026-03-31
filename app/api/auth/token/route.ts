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

  if (!body.userId) {
    return NextResponse.json(
      { error: "Missing required field: userId" },
      { status: 400 }
    );
  }

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
    description: "Generate JWT tokens for authenticating against agent endpoints",
    usage:
      "POST /api/auth/token with { userId, email?, role? }",
  });
}
