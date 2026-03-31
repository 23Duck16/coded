import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ExecutionRecord } from "./types";

// ─── Storage ──────────────────────────────────────────────────────────────────

const HISTORY_PATH = path.join(process.cwd(), ".logs", "executions.jsonl");

/** In-memory store for fast access */
const records = new Map<string, ExecutionRecord>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  if (!fs.existsSync(HISTORY_PATH)) return;
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    raw
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        const rec = JSON.parse(line) as ExecutionRecord;
        rec.timestamp = new Date(rec.timestamp);
        records.set(rec.id, rec);
      });
  } catch {
    // Corrupt log — start fresh in memory
  }
}

function persist(record: ExecutionRecord): void {
  try {
    const dir = path.dirname(HISTORY_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(HISTORY_PATH, line, "utf-8");
  } catch (err) {
    console.error("[execution-history] Failed to persist record:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function recordExecution(
  record: Omit<ExecutionRecord, "id" | "timestamp">
): Promise<string> {
  ensureLoaded();
  const id = randomUUID();
  const full: ExecutionRecord = { ...record, id, timestamp: new Date() };
  records.set(id, full);
  persist(full);
  return id;
}

export async function getExecution(
  executionId: string
): Promise<ExecutionRecord> {
  ensureLoaded();
  const rec = records.get(executionId);
  if (!rec) throw new Error(`Execution not found: ${executionId}`);
  return rec;
}

export async function listExecutions(
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<ExecutionRecord[]> {
  ensureLoaded();
  const userRecords = [...records.values()]
    .filter((r) => r.userId === userId)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  return userRecords.slice(offset, offset + limit);
}

/**
 * Rollback deletes all files that were created by an execution.
 * It marks the record as rolled-back but does not remove it from history.
 */
export async function rollbackExecution(executionId: string): Promise<void> {
  ensureLoaded();
  const rec = records.get(executionId);
  if (!rec) throw new Error(`Execution not found: ${executionId}`);

  const repoRoot = process.cwd();

  for (const filePath of rec.filesCreated) {
    try {
      const abs = path.resolve(repoRoot, filePath);
      // Safety: only delete files inside the repo root
      if (abs.startsWith(repoRoot) && fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
    } catch (err) {
      console.warn(`[execution-history] Could not delete ${filePath}:`, err);
    }
  }

  // Mark rolled back
  rec.status = "failed";
  rec.errorMessage = "Rolled back by admin";
}

export async function getExecutionStats(userId: string): Promise<{
  totalExecutions: number;
  successCount: number;
  avgExecutionTime: number;
  totalFilesCreated: number;
  totalTokensUsed: number;
}> {
  ensureLoaded();
  const userRecords = [...records.values()].filter(
    (r) => r.userId === userId
  );

  const total = userRecords.length;
  if (total === 0) {
    return {
      totalExecutions: 0,
      successCount: 0,
      avgExecutionTime: 0,
      totalFilesCreated: 0,
      totalTokensUsed: 0,
    };
  }

  const successCount = userRecords.filter(
    (r) => r.status === "success"
  ).length;
  const totalDuration = userRecords.reduce((acc, r) => acc + r.duration, 0);
  const totalFiles = userRecords.reduce(
    (acc, r) => acc + r.filesCreated.length,
    0
  );
  const totalTokens = userRecords.reduce(
    (acc, r) => acc + r.tokensUsed,
    0
  );

  return {
    totalExecutions: total,
    successCount,
    avgExecutionTime: totalDuration / total,
    totalFilesCreated: totalFiles,
    totalTokensUsed: totalTokens,
  };
}
