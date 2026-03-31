/**
 * lib/auth-middleware.ts
 *
 * JWT-based authentication using the `jose` library (Web Crypto API, Edge-safe).
 *
 * Tokens are signed with a symmetric HS256 key derived from AUTH_SECRET env var.
 * Extract auth context from the Authorization header (Bearer token) or the
 * `auth_token` cookie.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";
import type { AuthContext } from "./types";

// ─── Configuration ────────────────────────────────────────────────────────────

const SECRET_KEY = process.env.AUTH_SECRET ?? "dev-secret-change-in-production";

/** Convert the string secret to a Uint8Array for jose */
function getSecretBytes(): Uint8Array {
  return new TextEncoder().encode(SECRET_KEY);
}

export const JWT_EXPIRY = process.env.JWT_EXPIRY ?? "8h";

// ─── Token generation ─────────────────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  role: "admin" | "user";
}

/**
 * Sign and return a JWT for the given payload.
 */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecretBytes());
}

// ─── Token validation ─────────────────────────────────────────────────────────

type VerifyResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; error: string };

/**
 * Verify a raw JWT string and return the auth context.
 */
export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, getSecretBytes());
    const auth = payloadToAuthContext(payload);
    if (!auth) {
      return { ok: false, error: "Invalid token payload" };
    }
    return { ok: true, auth };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token verification failed";
    return { ok: false, error: message };
  }
}

function payloadToAuthContext(
  payload: JWTPayload
): AuthContext | null {
  const { userId, role, iat, exp } = payload as JWTPayload & {
    userId?: string;
    role?: string;
  };

  if (typeof userId !== "string" || !userId) return null;
  if (role !== "admin" && role !== "user") return null;
  // `iat` is a standard claim we always set when signing — reject tokens without it
  if (!iat) return null;

  return {
    userId,
    role,
    issuedAt: new Date(iat * 1_000).toISOString(),
    expiresAt: exp ? new Date(exp * 1_000).toISOString() : "",
  };
}

// ─── Request extraction ───────────────────────────────────────────────────────

/**
 * Extract and verify a JWT from a Next.js request.
 * Checks the `Authorization: Bearer <token>` header first, then the
 * `auth_token` cookie.
 *
 * Returns `{ ok: false }` if no token is present or verification fails.
 */
export async function extractAuthContext(
  req: NextRequest
): Promise<VerifyResult> {
  // 1. Authorization header
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return verifyToken(token);
  }

  // 2. Cookie
  const cookieToken = req.cookies.get("auth_token")?.value;
  if (cookieToken) return verifyToken(cookieToken);

  return { ok: false, error: "No authentication token provided" };
}

/**
 * Require authentication — returns auth context or throws a Response.
 * Suitable for use at the top of route handlers.
 */
export async function requireAuth(
  req: NextRequest
): Promise<AuthContext> {
  const result = await extractAuthContext(req);
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { status: 401 });
  }
  return result.auth;
}

/**
 * Require admin role — returns auth context or throws.
 */
export async function requireAdmin(req: NextRequest): Promise<AuthContext> {
  const auth = await requireAuth(req);
  if (auth.role !== "admin") {
    throw Object.assign(new Error("Admin role required"), { status: 403 });
  }
  return auth;
}
