/**
 * lib/audit-logger.ts
 *
 * Structured event logging to a JSONL (newline-delimited JSON) file.
 * Each line is a complete, self-contained JSON object (AuditEvent).
 *
 * File location: <cwd>/logs/audit.jsonl  (created automatically)
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AuditEvent, AuditEventType } from "./types";

// ─── Configuration ────────────────────────────────────────────────────────────

const LOG_DIR = process.env.AUDIT_LOG_DIR ?? path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "audit.jsonl");

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeEvent(event: AuditEvent): void {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    // Never crash the main request because of a logging failure
    console.error("[audit-logger] Failed to write event:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type LogEventInput = Omit<AuditEvent, "id" | "timestamp">;

/**
 * Append a structured audit event to the log file.
 * Returns the completed AuditEvent (with generated id + timestamp).
 */
export function logEvent(input: LogEventInput): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...input,
  };
  writeEvent(event);
  return event;
}

/**
 * Convenience wrapper for a successful event.
 */
export function logSuccess(
  type: AuditEventType,
  userId: string,
  role: string,
  opts: { resource?: string; action?: string; metadata?: Record<string, unknown> } = {}
): AuditEvent {
  return logEvent({ type, userId, role, result: "success", ...opts });
}

/**
 * Convenience wrapper for a failed event.
 */
export function logFailure(
  type: AuditEventType,
  userId: string,
  role: string,
  opts: { resource?: string; action?: string; metadata?: Record<string, unknown> } = {}
): AuditEvent {
  return logEvent({ type, userId, role, result: "failure", ...opts });
}

/**
 * Convenience wrapper for a denied event.
 */
export function logDenied(
  type: AuditEventType,
  userId: string,
  role: string,
  opts: { resource?: string; action?: string; metadata?: Record<string, unknown> } = {}
): AuditEvent {
  return logEvent({ type, userId, role, result: "denied", ...opts });
}

/**
 * Read and parse the most recent `limit` audit events from the log file.
 * Returns events in reverse-chronological order (newest first).
 */
export function readRecentEvents(limit = 100): AuditEvent[] {
  try {
    ensureLogDir();
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEvent => e !== null);
    return lines.slice(-limit).reverse();
  } catch (err) {
    console.error("[audit-logger] Failed to read events:", err);
    return [];
  }
}
