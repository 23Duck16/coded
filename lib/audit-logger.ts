import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AuditEvent } from "./types";

// ─── Storage Path ─────────────────────────────────────────────────────────────

const LOG_PATH =
  process.env.AUDIT_LOG_PATH ??
  path.join(process.cwd(), ".logs", "audit.jsonl");

function ensureLogDir(): void {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── In-memory cache (for fast querying in local/test environments) ───────────

const memoryLog: AuditEvent[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

export async function logEvent(
  event: Omit<AuditEvent, "id" | "timestamp">
): Promise<void> {
  const fullEvent: AuditEvent = {
    ...event,
    id: randomUUID(),
    timestamp: new Date(),
  };

  memoryLog.push(fullEvent);

  try {
    ensureLogDir();
    const line = JSON.stringify(fullEvent) + "\n";
    fs.appendFileSync(LOG_PATH, line, "utf-8");
  } catch (err) {
    // Non-fatal — log to stderr and continue
    console.error("[audit-logger] Failed to write to log file:", err);
  }
}

export async function getAuditLog(
  userId?: string,
  startDate?: Date,
  endDate?: Date,
  limit: number = 100
): Promise<AuditEvent[]> {
  // Merge in-memory log with persisted log (deduplicated by id)
  const persisted = readPersistedLog();
  const merged = dedup([...persisted, ...memoryLog]);

  let filtered = merged;

  if (userId) {
    filtered = filtered.filter((e) => e.userId === userId);
  }
  if (startDate) {
    filtered = filtered.filter(
      (e) => new Date(e.timestamp) >= startDate
    );
  }
  if (endDate) {
    filtered = filtered.filter(
      (e) => new Date(e.timestamp) <= endDate
    );
  }

  // Most recent first
  filtered.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return filtered.slice(0, limit);
}

export async function getExecutionStats(userId: string): Promise<{
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  filesCreated: number;
  tokensUsed: number;
}> {
  const events = await getAuditLog(userId, undefined, undefined, 10_000);
  const executions = events.filter((e) => e.action === "code_execution");

  const total = executions.length;
  if (total === 0) {
    return {
      totalExecutions: 0,
      successRate: 0,
      avgDuration: 0,
      filesCreated: 0,
      tokensUsed: 0,
    };
  }

  const successCount = executions.filter((e) => e.status === "success").length;
  const totalDuration = executions.reduce(
    (acc, e) => acc + (e.duration ?? 0),
    0
  );
  const totalTokens = executions.reduce(
    (acc, e) => acc + (e.tokensUsed ?? 0),
    0
  );
  const filesCreated = executions.reduce(
    (acc, e) => acc + (e.filesAffected?.length ?? 0),
    0
  );

  return {
    totalExecutions: total,
    successRate: successCount / total,
    avgDuration: totalDuration / total,
    filesCreated,
    tokensUsed: totalTokens,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readPersistedLog(): AuditEvent[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as AuditEvent;
        parsed.timestamp = new Date(parsed.timestamp);
        return parsed;
      });
  } catch {
    return [];
  }
}

function dedup(events: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
