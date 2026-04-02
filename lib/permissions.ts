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
import type {
  AgentRequest,
  PermissionCheckResult,
  PermissionPolicy,
} from "./types";

// ─── Default Policy ───────────────────────────────────────────────────────────

export function getDefaultPolicy(): PermissionPolicy {
  return {
    allowedPaths: ["app/**", "lib/**", "templates/**", "public/**"],
    blockedPaths: [
      "package.json",
      "tsconfig.json",
      "next.config.js",
      "vercel.json",
      ".env",
      ".env.*",
      ".git/**",
      "node_modules/**",
    ],
    maxFileSize: 1024 * 1024, // 1 MB
    allowedActions: [
      "create_file",
      "update_file",
      "apply_template",
      "multi_step",
    ],
  };
}

// ─── Glob Matching ────────────────────────────────────────────────────────────

/**
 * Minimal glob matcher supporting `*`, `**`, and `?` wildcards.
 * Handles patterns like "app/**", ".env.*", "package.json".
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalise separators
  const fp = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");

  // Convert glob pattern to a regular expression
  const regexStr = pat
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (not * ?)
    .replace(/\\\./g, ".") // un-escape dots that we need as literals
    .replace(/\*\*/g, "##DOUBLE##") // placeholder for **
    .replace(/\*/g, "[^/]*") // * → match anything except /
    .replace(/\?/g, "[^/]") // ? → match single non-/ char
    .replace(/##DOUBLE##/g, ".*"); // ** → match anything including /

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(fp);
}

function isBlocked(filePath: string, blockedPaths: string[]): boolean {
  return blockedPaths.some((pattern) => matchesGlob(filePath, pattern));
}

function isAllowed(filePath: string, allowedPaths: string[]): boolean {
  return allowedPaths.some((pattern) => matchesGlob(filePath, pattern));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkFilePermission(
  filePath: string,
  action: "read" | "write" | "delete",
  policy: PermissionPolicy
): Promise<PermissionCheckResult> {
  const normalised = filePath.replace(/\\/g, "/").replace(/^\//, "");

  if (isBlocked(normalised, policy.blockedPaths)) {
    return {
      allowed: false,
      reason: `Path "${filePath}" is blocked by policy`,
      severity: "error",
    };
  }

  // Read-only access is not restricted to allowed paths
  if (action === "read") {
    return { allowed: true };
  }

  if (!isAllowed(normalised, policy.allowedPaths)) {
    return {
      allowed: false,
      reason: `Path "${filePath}" is outside the allowed directories`,
      severity: "error",
    };
  }

  return { allowed: true };
}

export async function checkStepPermissions(
  step: AgentRequest,
  policy: PermissionPolicy
): Promise<PermissionCheckResult> {
  // Check that the action itself is allowed
  if (!policy.allowedActions.includes(step.action as (typeof policy.allowedActions)[number])) {
    return {
      allowed: false,
      reason: `Action "${step.action}" is not permitted by policy`,
      severity: "error",
    };
  }

  // Validate the target path if present
  if (step.target_path) {
    const fileCheck = await checkFilePermission(
      step.target_path,
      "write",
      policy
    );
    if (!fileCheck.allowed) return fileCheck;
  }

  // Recursively validate nested steps (multi_step)
  if (step.steps && step.steps.length > 0) {
    for (const nested of step.steps) {
      const nestedCheck = await checkStepPermissions(
        { action: "create_file", ...nested } as AgentRequest,
        policy
      );
      if (!nestedCheck.allowed) return nestedCheck;
    }
  }

  return { allowed: true };
}
