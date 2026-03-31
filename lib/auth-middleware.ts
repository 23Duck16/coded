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
