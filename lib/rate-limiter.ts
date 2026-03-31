import type { RateLimitConfig, RateLimitStatus } from "./types";

// ─── Default Config ───────────────────────────────────────────────────────────

export const defaultLimitConfig: RateLimitConfig = {
  maxRequestsPerMinute:
    Number(process.env.AGENT_MAX_REQUESTS_PER_MINUTE) || 60,
  maxExecutionsPerHour:
    Number(process.env.AGENT_MAX_EXECUTIONS_PER_HOUR) || 100,
  maxTokensPerDay: Number(process.env.AGENT_MAX_TOKENS_PER_DAY) || 1_000_000,
  burstSize: 5,
};

// ─── In-memory store ──────────────────────────────────────────────────────────

interface BucketEntry {
  /** Tokens remaining in the current minute window */
  minuteTokens: number;
  /** Timestamp of the start of the current minute window */
  minuteWindowStart: number;
  /** Executions in the current hour window */
  hourExecutions: number;
  /** Timestamp of the start of the current hour window */
  hourWindowStart: number;
  /** LLM tokens consumed today */
  dailyTokens: number;
  /** Timestamp of midnight (UTC) that starts the current day */
  dayWindowStart: number;
}

const store = new Map<string, BucketEntry>();

function now(): number {
  return Date.now();
}

function getOrCreate(userId: string): BucketEntry {
  if (!store.has(userId)) {
    const ts = now();
    store.set(userId, {
      minuteTokens: 0,
      minuteWindowStart: ts,
      hourExecutions: 0,
      hourWindowStart: ts,
      dailyTokens: 0,
      dayWindowStart: startOfDayUtc(ts),
    });
  }
  return store.get(userId)!;
}

function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function resetExpiredWindows(entry: BucketEntry): void {
  const ts = now();
  const ONE_MINUTE = 60_000;
  const ONE_HOUR = 3_600_000;

  if (ts - entry.minuteWindowStart >= ONE_MINUTE) {
    entry.minuteTokens = 0;
    entry.minuteWindowStart = ts;
  }
  if (ts - entry.hourWindowStart >= ONE_HOUR) {
    entry.hourExecutions = 0;
    entry.hourWindowStart = ts;
  }
  const todayStart = startOfDayUtc(ts);
  if (entry.dayWindowStart !== todayStart) {
    entry.dailyTokens = 0;
    entry.dayWindowStart = todayStart;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig
): Promise<RateLimitStatus> {
  const entry = getOrCreate(userId);
  resetExpiredWindows(entry);

  // Daily token quota
  if (entry.dailyTokens >= config.maxTokensPerDay) {
    const dayResetAt = new Date(entry.dayWindowStart + 86_400_000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: dayResetAt,
      quotaExceeded: true,
    };
  }

  // Per-hour execution quota
  if (entry.hourExecutions >= config.maxExecutionsPerHour) {
    const hourResetAt = new Date(entry.hourWindowStart + 3_600_000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: hourResetAt,
    };
  }

  // Per-minute request quota (burst included)
  const effective = Math.max(
    config.maxRequestsPerMinute,
    config.burstSize
  );
  if (entry.minuteTokens >= effective) {
    const minuteResetAt = new Date(entry.minuteWindowStart + 60_000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: minuteResetAt,
    };
  }

  entry.minuteTokens += 1;
  entry.hourExecutions += 1;

  const remaining = effective - entry.minuteTokens;
  return {
    allowed: true,
    remaining,
    resetAt: new Date(entry.minuteWindowStart + 60_000),
  };
}

export async function consumeTokens(
  userId: string,
  tokens: number
): Promise<void> {
  const entry = getOrCreate(userId);
  entry.dailyTokens += tokens;
}

export async function resetQuota(userId: string): Promise<void> {
  store.delete(userId);
}
