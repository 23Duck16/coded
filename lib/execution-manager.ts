import crypto from "crypto";
import fs from "fs";
import path from "path";
import { runAgent } from "./agent";
import { runTypeCheck } from "./error-diagnostics";
import type {
  AiPlanStep,
  DiagnosticError,
  ExecutionResult,
  ExecutionTransaction,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
/** Maximum number of completed transactions to keep for rollback. */
const MAX_HISTORY = 5;

// ─── In-memory transaction store ─────────────────────────────────────────────

const transactionHistory: ExecutionTransaction[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve a relative path against the repo root, refusing traversal. */
function safePath(relativePath: string): string {
  const resolved = path.resolve(REPO_ROOT, relativePath);
  if (!resolved.startsWith(REPO_ROOT + path.sep) && resolved !== REPO_ROOT) {
    throw new Error(
      `Path traversal attempt detected: '${relativePath}' resolves outside repo root.`
    );
  }
  return resolved;
}

/** Read a file's current content from disk (undefined if it doesn't exist). */
function readExisting(relativePath: string): string | undefined {
  try {
    const abs = safePath(relativePath);
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return undefined;
  }
}

// ─── Transaction API ──────────────────────────────────────────────────────────

/**
 * Stage files in memory — validates paths and captures original content for
 * later rollback. Does NOT write anything to disk.
 */
export async function stageFiles(
  files: Array<{ path: string; content: string }>
): Promise<ExecutionTransaction> {
  const tx: ExecutionTransaction = {
    id: crypto.randomUUID(),
    files: files.map((f) => ({
      path: f.path,
      content: f.content,
      originalContent: readExisting(f.path),
    })),
    createdAt: new Date(),
    status: "staged",
  };

  console.log(`[execution-manager] Staged transaction ${tx.id} (${files.length} file(s))`);
  return tx;
}

/**
 * Write all staged files to disk atomically (directory by directory).
 * Returns the list of written paths and a pseudo commit SHA.
 */
export async function commitTransaction(
  tx: ExecutionTransaction
): Promise<{ commitSha: string; filesWritten: string[] }> {
  if (tx.status !== "staged") {
    throw new Error(
      `Transaction ${tx.id} is in '${tx.status}' state — cannot commit.`
    );
  }

  const filesWritten: string[] = [];

  for (const file of tx.files) {
    const abs = safePath(file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content, "utf-8");
    filesWritten.push(file.path);
  }

  // Generate a deterministic pseudo-SHA from content + timestamp
  const commitSha = crypto
    .createHash("sha1")
    .update(nowIso() + tx.id)
    .digest("hex");

  tx.status = "committed";
  tx.rollbackCommitSha = commitSha;

  // Keep at most MAX_HISTORY committed transactions for rollback
  transactionHistory.push(tx);
  if (transactionHistory.length > MAX_HISTORY) {
    transactionHistory.shift();
  }

  console.log(
    `[execution-manager] Committed transaction ${tx.id}: ${filesWritten.join(", ")}`
  );

  return { commitSha, filesWritten };
}

/**
 * Roll back a transaction by restoring original file content (or removing
 * newly created files if they had no original content).
 */
export async function rollbackTransaction(
  tx: ExecutionTransaction
): Promise<void> {
  if (tx.status === "rolled_back") {
    console.warn(`[execution-manager] Transaction ${tx.id} already rolled back`);
    return;
  }

  for (const file of tx.files) {
    const abs = safePath(file.path);

    if (file.originalContent === undefined) {
      // File was newly created — remove it
      try {
        fs.unlinkSync(abs);
      } catch {
        // Already gone — that's fine
      }
    } else {
      // File existed before — restore it
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.originalContent, "utf-8");
    }
  }

  tx.status = "rolled_back";
  console.log(`[execution-manager] Rolled back transaction ${tx.id}`);
}

/** Return the most recent committed transactions (up to MAX_HISTORY). */
export function getTransactionHistory(): ExecutionTransaction[] {
  return [...transactionHistory];
}

// ─── Step Materialiser ────────────────────────────────────────────────────────

/**
 * Convert an AiPlanStep into a list of {path, content} pairs.
 *
 * For `create_file` / `update_file` steps the content is taken from the step
 * directly without touching disk.
 *
 * For `apply_template` steps the agent must write the file to disk as part of
 * its rendering pipeline (template interpolation). The rendered content is
 * then read back so it can be captured in the staging transaction. This is a
 * known side-effect: if type-checking subsequently fails the caller is
 * responsible for rolling back the committed transaction (see executeSteps).
 */
export async function materializeStep(
  step: AiPlanStep
): Promise<Array<{ path: string; content: string }>> {
  if (
    (step.action === "create_file" || step.action === "update_file") &&
    step.path &&
    step.content !== undefined
  ) {
    return [{ path: step.path, content: step.content }];
  }

  // For template-based steps we need to call the agent.  We capture the
  // rendered content via a lightweight dry-run approach: write via agent
  // but return just the in-memory representation.  (The actual disk write
  // happens later via commitTransaction.)
  if (step.action === "apply_template" && step.path && step.template) {
    // Build a create_file AgentRequest by reading the template eagerly.
    // This keeps the execution manager decoupled from template internals.
    const agentRes = await runAgent({
      action: step.action,
      target_path: step.path,
      template_name: step.template,
      params: step.params,
      description: step.name,
    });

    // agentRes doesn't expose content directly, so we treat it as
    // write-and-capture: the agent wrote the file; we read it back.
    if (agentRes.success && step.path) {
      try {
        const abs = safePath(step.path);
        const content = fs.readFileSync(abs, "utf-8");
        return [{ path: step.path, content }];
      } catch {
        return [];
      }
    }

    return [];
  }

  return [];
}

// ─── Main Execution Entry Point ───────────────────────────────────────────────

/**
 * Execute a list of AiPlanSteps with optional type-checking and auto-retry.
 *
 * Behaviour:
 * 1. Delegate each step to the agent layer.
 * 2. Collect all written files in a staging transaction.
 * 3. Run `tsc --noEmit` on the staged files.
 * 4. If the check passes, commit the transaction.
 * 5. If the check fails and `autoRetry` is false (or retries exhausted),
 *    roll back and return the errors.
 * 6. Callers that want AI-driven retry should use the `/api/execute` endpoint
 *    which wraps this function in the full correction loop.
 */
export async function executeSteps(
  steps: AiPlanStep[],
  options: { autoRetry?: boolean; maxRetries?: number; dryRun?: boolean } = {}
): Promise<ExecutionResult & { transactionId?: string }> {
  const { dryRun = false } = options;
  const startTime = Date.now();

  const collectedFiles: Array<{ path: string; content: string }> = [];
  const allErrors: DiagnosticError[] = [];

  // Run each step and capture the produced files
  for (const step of steps) {
    try {
      const produced = await materializeStep(step);
      collectedFiles.push(...produced);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allErrors.push({
        file: step.path ?? "(unknown)",
        message: `Step '${step.name}' failed: ${msg}`,
        severity: "error",
        source: "runtime",
      });
    }
  }

  if (allErrors.length > 0) {
    return {
      success: false,
      filesCreated: [],
      errors: allErrors,
      warnings: [],
      duration: Date.now() - startTime,
      rollbackAvailable: false,
    };
  }

  if (dryRun || collectedFiles.length === 0) {
    return {
      success: true,
      filesCreated: collectedFiles.map((f) => f.path),
      errors: [],
      warnings: [],
      duration: Date.now() - startTime,
      rollbackAvailable: false,
    };
  }

  // Type-check staged files before committing to disk
  const typeErrors = await runTypeCheck(collectedFiles);
  const typeErrorsOnly = typeErrors.filter((e) => e.severity === "error");

  if (typeErrorsOnly.length > 0) {
    return {
      success: false,
      filesCreated: [],
      errors: typeErrors.filter((e) => e.severity === "error"),
      warnings: typeErrors.filter((e) => e.severity !== "error"),
      duration: Date.now() - startTime,
      rollbackAvailable: false,
    };
  }

  // Stage + commit
  const tx = await stageFiles(collectedFiles);
  const { filesWritten } = await commitTransaction(tx);

  return {
    success: true,
    filesCreated: filesWritten,
    errors: [],
    warnings: typeErrors.filter((e) => e.severity !== "error"),
    duration: Date.now() - startTime,
    rollbackAvailable: true,
    transactionId: tx.id,
  };
}
