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
