import { execSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { DiagnosticError, ExecutionResult } from "./types";

// ─── TSC Output Parser ────────────────────────────────────────────────────────

/**
 * Parse the text output produced by `tsc --noEmit` (not JSON mode) into
 * structured DiagnosticError objects.
 *
 * Example tsc line:
 *   app/api/reports/route.ts(12,5): error TS2552: Cannot find name 'Report'.
 */
export function parseCompilerErrors(tscOutput: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];

  // Match lines like: path/to/file.ts(line,col): severity TScode: message
  const lineRe =
    /^(.+?)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s+(.+)$/;

  for (const line of tscOutput.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;

    const [, file, lineStr, colStr, rawSeverity, code, message] = m;
    const severity =
      rawSeverity === "warning"
        ? "warning"
        : rawSeverity === "message"
          ? "info"
          : "error";

    errors.push({
      file,
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      code,
      message: message.trim(),
      severity,
      source: "tsc",
      suggestion: suggestFix(code, message),
    });
  }

  return errors;
}

// ─── ESLint Output Parser ─────────────────────────────────────────────────────

/**
 * Parse ESLint JSON output (produced with `--format json`) into
 * structured DiagnosticError objects.
 */
export function parseEslintOutput(eslintJson: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];

  let parsed: Array<{
    filePath: string;
    messages: Array<{
      line?: number;
      column?: number;
      ruleId?: string | null;
      message: string;
      severity: number; // 1 = warning, 2 = error
    }>;
  }>;

  try {
    parsed = JSON.parse(eslintJson) as typeof parsed;
  } catch {
    return errors;
  }

  for (const fileResult of parsed) {
    for (const msg of fileResult.messages) {
      errors.push({
        file: fileResult.filePath,
        line: msg.line,
        column: msg.column,
        code: msg.ruleId ?? undefined,
        message: msg.message,
        severity: msg.severity === 1 ? "warning" : "error",
        source: "eslint",
      });
    }
  }

  return errors;
}

// ─── Runner: TypeScript ───────────────────────────────────────────────────────

/**
 * Write `files` to a temporary directory and run `tsc --noEmit` against them.
 * Returns a list of structured DiagnosticErrors (empty list = clean).
 */
export async function runTypeCheck(
  files: Array<{ path: string; content: string }>
): Promise<DiagnosticError[]> {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "codespring-phase3-tsc-")
  );

  try {
    // Write files preserving directory structure
    for (const file of files) {
      const dest = path.join(tmpDir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, "utf-8");
    }

    // Minimal tsconfig for type checking
    const tsConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        strict: false,
        noEmit: true,
        esModuleInterop: true,
        paths: { "@/*": ["./*"] },
      },
      include: ["./**/*.ts", "./**/*.tsx"],
    };

    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify(tsConfig, null, 2)
    );

    try {
      // Use the repo-local tsc binary with an absolute path to avoid PATH manipulation
      const tscBin = path.resolve(
        process.cwd(),
        "node_modules",
        ".bin",
        "tsc"
      );
      execSync(`"${tscBin}" --noEmit`, { cwd: tmpDir, stdio: "pipe" });
      return []; // No errors
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as NodeJS.ErrnoException & { stderr: unknown }).stderr)
          : "";
      const stdout =
        err instanceof Error && "stdout" in err
          ? String((err as NodeJS.ErrnoException & { stdout: unknown }).stdout)
          : "";
      const raw = (stderr + "\n" + stdout).trim();

      // Re-map temp-dir paths back to the original file paths
      const remapped = raw.replaceAll(tmpDir + path.sep, "");
      return parseCompilerErrors(remapped);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Runner: ESLint ──────────────────────────────────────────────────────────

/**
 * Write `files` to a temp directory and run ESLint (if available) with
 * JSON output. Gracefully returns an empty list if ESLint is not installed.
 */
export async function runLinter(
  files: Array<{ path: string; content: string }>
): Promise<DiagnosticError[]> {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "codespring-phase3-lint-")
  );

  try {
    for (const file of files) {
      const dest = path.join(tmpDir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, "utf-8");
    }

    // Write a minimal .eslintrc so ESLint doesn't fail with "no config"
    fs.writeFileSync(
      path.join(tmpDir, ".eslintrc.json"),
      JSON.stringify({ extends: ["eslint:recommended"] })
    );

    // Collect files to lint (pass explicit file list instead of shell glob to
    // avoid command injection via file names or shell expansion)
    const filesToLint = files
      .map((f) => path.join(tmpDir, f.path))
      .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));

    if (filesToLint.length === 0) return [];

    // Use the repo-local eslint binary with an absolute path
    const eslintBin = path.resolve(
      process.cwd(),
      "node_modules",
      ".bin",
      "eslint"
    );

    if (!fs.existsSync(eslintBin)) {
      // ESLint not installed — skip silently
      return [];
    }

    const result = spawnSync(
      eslintBin,
      ["--format", "json", ...filesToLint],
      { cwd: tmpDir, encoding: "utf-8" }
    );

    const stdout = result.stdout ?? "";
    if (stdout.startsWith("[")) {
      const remapped = stdout.replaceAll(tmpDir + path.sep, "");
      return parseEslintOutput(remapped);
    }
    return [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Aggregate Result Builder ─────────────────────────────────────────────────

/**
 * Build an ExecutionResult from a list of diagnostics and metadata.
 */
export function buildExecutionResult(
  filesCreated: string[],
  diagnostics: DiagnosticError[],
  durationMs: number,
  rollbackAvailable: boolean
): ExecutionResult {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity !== "error");

  return {
    success: errors.length === 0,
    filesCreated,
    errors,
    warnings,
    duration: durationMs,
    rollbackAvailable,
  };
}

// ─── Fix Suggestions ──────────────────────────────────────────────────────────

function suggestFix(code: string, message: string): string | undefined {
  switch (code) {
    case "TS2552":
      // "Cannot find name 'X'. Did you mean 'Y'?"
      return "Check that the name is spelled correctly and the correct module is imported.";
    case "TS2307":
      // "Cannot find module 'X' or its corresponding type declarations."
      return "Verify the import path is correct and the module exists in the project.";
    case "TS2322":
      return "Ensure the value being assigned matches the expected type.";
    case "TS2345":
      return "Verify the argument type matches the parameter type.";
    case "TS2339":
      return "Check that the property exists on the type or add the property definition.";
    case "TS1005":
      return message.includes("';' expected")
        ? "Add a missing semicolon."
        : undefined;
    default:
      return undefined;
  }
}
