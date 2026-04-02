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
import { NextRequest, NextResponse } from "next/server";
import type { AuthContext, AuthMiddlewareConfig } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET_KEY =
  process.env.AGENT_SECRET_KEY ?? "change-me-in-production";

// ─── JWT helpers (no external dependency) ────────────────────────────────────
// We implement a minimal HS256 JWT so we don't need to add jsonwebtoken to deps.

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string): string {
  const pad = input.length % 4;
  const padded = pad ? input + "=".repeat(4 - pad) : input;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

async function hmacSha256(key: string, data: string): Promise<string> {
  // Node.js crypto — works in the App Router (Node.js runtime)
  const { createHmac } = await import("crypto");
  return createHmac("sha256", key).update(data).digest("base64url");
}

export async function signToken(
  payload: Record<string, unknown>,
  expiresInSeconds: number = 86400
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })
  );
  const sig = await hmacSha256(SECRET_KEY, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

async function verifyToken(
  token: string,
  secretKey: string = SECRET_KEY
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  const [header, body, sig] = parts;
  const expected = await hmacSha256(secretKey, `${header}.${body}`);
  if (sig !== expected) throw new Error("Invalid JWT signature");

  const payload = JSON.parse(base64urlDecode(body)) as Record<string, unknown>;
  const exp = payload.exp as number | undefined;
  if (exp && Math.floor(Date.now() / 1000) > exp) {
    throw new Error("Token expired");
  }

  return payload;
}

// ─── API key store ────────────────────────────────────────────────────────────

/** Simple env-var API key: AGENT_API_KEY=sk-xxxxxxx */
function getEnvApiKey(): string | undefined {
  return process.env.AGENT_API_KEY;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseAuthHeader(
  authHeader: string,
  secretKey: string = SECRET_KEY
): Promise<AuthContext> {
  // Bearer token (JWT)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token, secretKey);
    return {
      userId: String(payload.sub ?? payload.userId ?? "unknown"),
      email: String(payload.email ?? ""),
      role: (payload.role as AuthContext["role"]) ?? "user",
      permissions: (payload.permissions as string[] | undefined) ?? [],
    };
  }

  // API key (sk- prefix)
  if (authHeader.startsWith("ApiKey ")) {
    const apiKey = authHeader.slice(7);
    const envKey = getEnvApiKey();
    if (!envKey || apiKey !== envKey) {
      throw new Error("Invalid API key");
    }
    return {
      userId: "api-key-user",
      email: "api@system",
      role: "service",
      apiKey,
    };
  }

  throw new Error("Unsupported authorization scheme");
}

/**
 * Extract auth context from a request.
 * Returns null when auth is not required and no header is present.
 * Throws when auth is required but missing/invalid.
 */
export async function extractAuth(
  req: NextRequest,
  config: AuthMiddlewareConfig = { requireAuth: false }
): Promise<AuthContext | null> {
  const requireAuth =
    config.requireAuth ?? process.env.AGENT_REQUIRE_AUTH === "true";

  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    if (requireAuth) throw new Error("Missing Authorization header");
    // Return a default anonymous context when auth is optional
    return {
      userId: "anonymous",
      email: "",
      role: "user",
    };
  }

  const ctx = await parseAuthHeader(authHeader, config.secretKey ?? SECRET_KEY);

  if (config.allowedRoles && !config.allowedRoles.includes(ctx.role)) {
    throw new Error(
      `Role "${ctx.role}" is not authorized for this resource`
    );
  }

  return ctx;
}

/**
 * Higher-order helper that returns an unauthorized response
 * or the auth context, so route handlers can do:
 *
 *   const auth = await requireAuth()(req);
 *   if (!auth) return;  // response already sent
 */
export function requireAuth(
  roles?: string[]
): (req: NextRequest) => Promise<AuthContext | NextResponse> {
  return async (req: NextRequest) => {
    try {
      const ctx = await extractAuth(req, {
        requireAuth: true,
        allowedRoles: roles,
      });
      if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return ctx;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }
  };
}

export function createAuthMiddleware(
  config: AuthMiddlewareConfig
): (req: NextRequest) => Promise<NextResponse | null> {
  return async (req: NextRequest) => {
    try {
      await extractAuth(req, config);
      return null; // proceed
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }
  };
}
