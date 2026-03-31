/**
 * lib/permissions.ts
 *
 * File path + action validation with simple glob matching.
 * Prevents agents from writing outside allowed directories or
 * touching sensitive system files.
 */

import type { AuthContext } from "./types";

// ─── Allowed path patterns (glob-style) ───────────────────────────────────────
// Agents may only write files that match at least one of these patterns.

const ALLOWED_WRITE_PATTERNS: readonly string[] = [
  "app/**",
  "lib/**",
  "components/**",
  "templates/**",
  "styles/**",
  "public/**",
  "docs/**",
];

// ─── Blocked path patterns ────────────────────────────────────────────────────
// These are always rejected regardless of allowed patterns.

const BLOCKED_PATTERNS: readonly string[] = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.key",
  "**/*.key",
  "*.pem",
  "**/*.pem",
  "node_modules/**",
  ".git/**",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "next.config.*",
];

// ─── Admin-only path patterns ─────────────────────────────────────────────────

const ADMIN_ONLY_PATTERNS: readonly string[] = [
  "app/admin/**",
  "app/api/auth/**",
];

export type PermissionAction = "read" | "write" | "delete" | "execute";

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports `*` (any chars except `/`) and `**` (any chars including `/`).
 */
function globToRegex(pattern: string): RegExp {
  const regexStr = pattern
    .split("")
    .reduce((acc, char, i, arr) => {
      if (char === "*" && arr[i + 1] === "*") {
        return acc + ".*"; // ** → match anything including /
      }
      if (char === "*" && arr[i - 1] === "*") {
        return acc; // second * of ** already handled
      }
      if (char === "*") {
        return acc + "[^/]*"; // single * → match within segment
      }
      if (char === "?") {
        return acc + "[^/]";
      }
      // escape regex special characters
      if (/[.+^${}()|[\]\\]/.test(char)) {
        return acc + "\\" + char;
      }
      return acc + char;
    }, "^") + "$";

  return new RegExp(regexStr);
}

/**
 * Returns true if `filePath` matches any pattern in the list.
 */
function matchesAny(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return patterns.some((pattern) => {
    const regex = globToRegex(pattern);
    return regex.test(normalized);
  });
}

/**
 * Check whether an authenticated user may perform `action` on `filePath`.
 *
 * Rules (in order of precedence):
 * 1. Blocked paths → always denied
 * 2. Admin-only paths → denied unless role === "admin"
 * 3. Write/delete/execute on paths outside ALLOWED_WRITE_PATTERNS → denied
 * 4. Otherwise → allowed
 */
export function checkPermission(
  action: PermissionAction,
  filePath: string,
  auth: AuthContext
): PermissionCheckResult {
  // 1. Blocked patterns
  if (matchesAny(filePath, BLOCKED_PATTERNS)) {
    return {
      allowed: false,
      reason: `Access to '${filePath}' is blocked by security policy`,
    };
  }

  // 2. Admin-only paths
  if (matchesAny(filePath, ADMIN_ONLY_PATTERNS) && auth.role !== "admin") {
    return {
      allowed: false,
      reason: `'${filePath}' requires admin role`,
    };
  }

  // 3. Write/delete/execute require path to be in the allow-list
  if (
    (action === "write" || action === "delete" || action === "execute") &&
    !matchesAny(filePath, ALLOWED_WRITE_PATTERNS)
  ) {
    return {
      allowed: false,
      reason: `Writing to '${filePath}' is not permitted. Allowed directories: ${ALLOWED_WRITE_PATTERNS.join(", ")}`,
    };
  }

  return { allowed: true };
}

/**
 * Validate all file paths in an agent request steps array.
 * Returns the first denial found, or `{ allowed: true }`.
 */
export function validateAgentPaths(
  paths: string[],
  action: PermissionAction,
  auth: AuthContext
): PermissionCheckResult {
  for (const p of paths) {
    const result = checkPermission(action, p, auth);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
