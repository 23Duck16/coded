/**
 * lib/execution-history.ts
 *
 * In-memory + file-based execution history with rollback support.
 *
 * Records are kept in memory for fast access and persisted to
 * <cwd>/logs/history.jsonl for durability across restarts.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ExecutionRecord, ExecutionStatus } from "./types";

// ─── Configuration ────────────────────────────────────────────────────────────

const LOG_DIR = process.env.AUDIT_LOG_DIR ?? path.join(process.cwd(), "logs");
const HISTORY_FILE = path.join(LOG_DIR, "history.jsonl");
const MAX_IN_MEMORY = 1_000;

// ─── In-memory store ──────────────────────────────────────────────────────────

let memoryStore: ExecutionRecord[] = [];
let loaded = false;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  try {
    ensureLogDir();
    if (!fs.existsSync(HISTORY_FILE)) return;
    const content = fs.readFileSync(HISTORY_FILE, "utf8");
    memoryStore = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ExecutionRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is ExecutionRecord => r !== null)
      .slice(-MAX_IN_MEMORY);
  } catch (err) {
    console.error("[execution-history] Failed to load history:", err);
  }
}

function persistRecord(record: ExecutionRecord): void {
  try {
    ensureLogDir();
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("[execution-history] Failed to persist record:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ListOptions {
  userId?: string;
  type?: ExecutionRecord["type"];
  status?: ExecutionStatus;
  limit?: number;
  offset?: number;
}

/**
 * Create and persist a new execution record.
 */
export function createRecord(
  data: Omit<ExecutionRecord, "id" | "timestamp" | "status"> & {
    status?: ExecutionStatus;
  }
): ExecutionRecord {
  loadFromDisk();
  const record: ExecutionRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    status: "pending",
    ...data,
  };
  memoryStore.push(record);
  if (memoryStore.length > MAX_IN_MEMORY) {
    memoryStore = memoryStore.slice(-MAX_IN_MEMORY);
  }
  persistRecord(record);
  return record;
}

/**
 * Update an existing record by id.
 * Persists the updated record as a new JSONL line (append-only log);
 * the most recent entry for a given id wins on read.
 */
export function updateRecord(
  id: string,
  updates: Partial<
    Pick<ExecutionRecord, "status" | "output" | "durationMs" | "error">
  >
): ExecutionRecord | null {
  loadFromDisk();
  const idx = memoryStore.findLastIndex((r) => r.id === id);
  if (idx === -1) return null;
  const updated = { ...memoryStore[idx], ...updates };
  memoryStore[idx] = updated;
  persistRecord(updated);
  return updated;
}

/**
 * Retrieve a single record by id (most recent version wins).
 */
export function getRecord(id: string): ExecutionRecord | null {
  loadFromDisk();
  // Search from end for most recent version
  for (let i = memoryStore.length - 1; i >= 0; i--) {
    if (memoryStore[i].id === id) return memoryStore[i];
  }
  return null;
}

/**
 * List execution records with optional filtering and pagination.
 * Returns newest records first.
 */
export function listRecords(options: ListOptions = {}): {
  records: ExecutionRecord[];
  total: number;
} {
  loadFromDisk();
  const { userId, type, status, limit = 50, offset = 0 } = options;

  // Deduplicate by id — keep last (most recently updated) version
  const seen = new Set<string>();
  const deduped: ExecutionRecord[] = [];
  for (let i = memoryStore.length - 1; i >= 0; i--) {
    const r = memoryStore[i];
    if (!seen.has(r.id)) {
      seen.add(r.id);
      deduped.push(r);
    }
  }

  let filtered = deduped;
  if (userId) filtered = filtered.filter((r) => r.userId === userId);
  if (type) filtered = filtered.filter((r) => r.type === type);
  if (status) filtered = filtered.filter((r) => r.status === status);

  return {
    total: filtered.length,
    records: filtered.slice(offset, offset + limit),
  };
}

/**
 * Attempt a rollback for a given execution record.
 *
 * If the record has a `rollbackSnapshot`, write those files back to disk.
 * Returns true on success, false if rollback is not available.
 */
export async function rollbackExecution(id: string): Promise<{
  success: boolean;
  message: string;
  filesRestored?: string[];
}> {
  loadFromDisk();
  const record = getRecord(id);
  if (!record) {
    return { success: false, message: `Execution '${id}' not found` };
  }
  if (!record.rollbackSnapshot || Object.keys(record.rollbackSnapshot).length === 0) {
    return {
      success: false,
      message: "No rollback snapshot available for this execution",
    };
  }

  const filesRestored: string[] = [];
  const cwd = process.cwd();

  for (const [relPath, content] of Object.entries(record.rollbackSnapshot)) {
    const absPath = path.join(cwd, relPath);
    try {
      if (content === null) {
        // File didn't exist before — delete it if it exists now
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, "utf8");
      }
      filesRestored.push(relPath);
    } catch (err) {
      return {
        success: false,
        message: `Failed to restore '${relPath}': ${err instanceof Error ? err.message : String(err)}`,
        filesRestored,
      };
    }
  }

  updateRecord(id, { status: "failed", error: "Rolled back by user" });
  return { success: true, message: "Rollback complete", filesRestored };
}
