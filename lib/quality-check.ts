import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface ValidationError {
  file: string;
  line?: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  fixable: boolean;
}

// ─── Critical system files that must never be overwritten ─────────────────────

const PROTECTED_PATHS = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".gitignore",
  ".eslintrc.json",
  "vercel.json",
  "README.md",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return true if any `{{PLACEHOLDER}}` pattern remains in the content. */
function hasUnresolvedPlaceholders(content: string): boolean {
  return /\{\{[A-Z_]+\}\}/.test(content);
}

/** Naïve check: look for import statements with paths that don't resolve. */
function findUnresolvedImports(
  filePath: string,
  content: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const match = line.match(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (!match) return;

    const importPath = match[1];

    // Skip package imports and TypeScript path aliases (e.g. "@/")
    if (!importPath.startsWith(".")) return;

    const dir = path.dirname(filePath);
    const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
    const resolved = extensions.some((ext) =>
      fs.existsSync(path.resolve(dir, importPath + ext))
    );

    if (!resolved) {
      errors.push({
        file: filePath,
        line: idx + 1,
        message: `Cannot resolve import '${importPath}'`,
      });
    }
  });

  return errors;
}

/**
 * Write files to a temporary directory, run `tsc --noEmit` against them, and
 * parse the compiler output into structured errors.
 */
function typeCheck(
  files: Array<{ path: string; content: string }>
): ValidationError[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codespring-typecheck-"));

  try {
    // Write each file into the temp dir (preserving sub-path structure)
    for (const file of files) {
      const dest = path.join(tmpDir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, "utf-8");
    }

    // Write a minimal tsconfig so tsc can run
    const tsConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["./**/*"],
    };
    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify(tsConfig, null, 2),
      "utf-8"
    );

    execSync("tsc --noEmit", { cwd: tmpDir, stdio: "pipe" });
    return [];
  } catch (err) {
    // execSync throws a SpawnSyncReturns-shaped error when tsc exits non-zero.
    // Both stdout and stderr may contain diagnostics.
    const output = [
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: unknown }).stdout ?? "")
        : "",
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return parseTscOutput(output || String(err));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Parse TypeScript compiler diagnostic output into ValidationError objects. */
function parseTscOutput(output: string): ValidationError[] {
  const errors: ValidationError[] = [];
  // Format: "path/to/file.ts(line,col): error TS<code>: message"
  const lineRe = /^(.+?)\((\d+),\d+\):\s+error TS\d+:\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRe.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      message: match[3],
    });
  }

  return errors;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a set of generated files before writing them to disk.
 *
 * Checks performed (in order):
 * 1. No duplicate file paths in the input set
 * 2. Files don't overwrite critical system files
 * 3. No unresolved `{{PLACEHOLDER}}` tokens
 * 4. Relative imports resolve to existing files
 * 5. TypeScript compilation succeeds (tsc --noEmit)
 */
export async function validateGenerated(
  files: Array<{ path: string; content: string }>
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // ── 1. Duplicate paths ─────────────────────────────────────────────────────
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) {
      errors.push({
        file: file.path,
        message: `Duplicate file path in generated set: ${file.path}`,
      });
    }
    seenPaths.add(file.path);
  }

  // ── 2. Protected file guard ────────────────────────────────────────────────
  for (const file of files) {
    const normalised = file.path.replace(/^\.\//, "");
    if (PROTECTED_PATHS.has(normalised)) {
      errors.push({
        file: file.path,
        message: `Refusing to overwrite protected system file: ${file.path}`,
      });
    }
  }

  // ── 3. Unresolved placeholders ────────────────────────────────────────────
  for (const file of files) {
    if (hasUnresolvedPlaceholders(file.content)) {
      errors.push({
        file: file.path,
        message:
          "File contains unresolved template placeholders ({{PLACEHOLDER}} syntax detected)",
      });
    }
  }

  // ── 4. Unresolved relative imports ────────────────────────────────────────
  for (const file of files) {
    const importErrors = findUnresolvedImports(file.path, file.content);
    errors.push(...importErrors);
  }

  // ── 5. TypeScript compilation ────────────────────────────────────────────
  const tsFiles = files.filter(
    (f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx")
  );

  if (tsFiles.length > 0) {
    // Only run tsc if it is available (skip in environments without Node tools)
    try {
      const tsErrors = typeCheck(tsFiles);
      errors.push(...tsErrors);
    } catch {
      warnings.push(
        "tsc not available in this environment; TypeScript check skipped"
      );
    }
  }

  const valid = errors.length === 0;

  // Errors are "fixable" if they are only placeholder or import issues
  // (i.e., not TypeScript compilation failures or protected-file violations)
  const fixable =
    !valid &&
    errors.every(
      (e) =>
        e.message.includes("placeholder") ||
        e.message.includes("Cannot resolve import")
    );

  return { valid, errors, warnings, fixable };
}
