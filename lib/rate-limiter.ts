/**
 * lib/rate-limiter.ts
 *
 * In-memory token-bucket rate limiter.
 *
 * Quotas (per userId):
 *   - 60 requests / minute    (sliding window via token bucket)
 *   - 100 executions / hour
 *   - 1,000,000 LLM tokens / day
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request will be accepted (0 if allowed) */
  retryAfterSeconds: number;
  remaining: {
    requestsPerMinute: number;
    executionsPerHour: number;
    tokensPerDay: number;
  };
}

interface Bucket {
  /** Floating-point token count */
  tokens: number;
  /** Last refill timestamp (ms) */
  lastRefill: number;
}

interface UserQuota {
  requestBucket: Bucket;
  execBucket: Bucket;
  tokenBucket: Bucket;
  /** Rolling token-usage windows: list of [timestamp, count] pairs */
  tokenUsage: Array<[number, number]>;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const REQUESTS_PER_MINUTE = 60;
const EXECUTIONS_PER_HOUR = 100;
const TOKENS_PER_DAY = 1_000_000;

const ONE_MINUTE_MS = 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

// ─── In-memory store ─────────────────────────────────────────────────────────

const store = new Map<string, UserQuota>();

function getOrCreate(userId: string): UserQuota {
  let quota = store.get(userId);
  if (!quota) {
    const now = Date.now();
    quota = {
      requestBucket: { tokens: REQUESTS_PER_MINUTE, lastRefill: now },
      execBucket: { tokens: EXECUTIONS_PER_HOUR, lastRefill: now },
      tokenBucket: { tokens: TOKENS_PER_DAY, lastRefill: now },
      tokenUsage: [],
    };
    store.set(userId, quota);
  }
  return quota;
}

/**
 * Refill a token bucket based on elapsed time since the last refill.
 */
function refill(bucket: Bucket, capacity: number, windowMs: number): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = (elapsed / windowMs) * capacity;
  bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}

/**
 * Consume one token from a bucket.
 * Returns { ok: true } if the token was consumed, or
 * { ok: false, retryAfterMs } if the bucket is empty.
 */
function consume(
  bucket: Bucket,
  capacity: number,
  windowMs: number,
  count = 1
): { ok: boolean; retryAfterMs: number } {
  refill(bucket, capacity, windowMs);
  if (bucket.tokens >= count) {
    bucket.tokens -= count;
    return { ok: true, retryAfterMs: 0 };
  }
  // How long until `count` tokens are available?
  const needed = count - bucket.tokens;
  const retryAfterMs = (needed / capacity) * windowMs;
  return { ok: false, retryAfterMs };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check and consume one request token for `userId`.
 * Pass `llmTokensUsed` to also deduct from the daily token quota.
 * Pass `isExecution = true` to also deduct from the hourly execution quota.
 */
export function checkRateLimit(
  userId: string,
  options: { isExecution?: boolean; llmTokensUsed?: number } = {}
): RateLimitResult {
  const quota = getOrCreate(userId);

  // ── Per-minute request check ──────────────────────────────────────────────
  const reqResult = consume(
    quota.requestBucket,
    REQUESTS_PER_MINUTE,
    ONE_MINUTE_MS
  );
  if (!reqResult.ok) {
    refill(quota.requestBucket, REQUESTS_PER_MINUTE, ONE_MINUTE_MS);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(reqResult.retryAfterMs / 1_000),
      remaining: remaining(quota),
    };
  }

  // ── Per-hour execution check ───────────────────────────────────────────────
  if (options.isExecution) {
    const execResult = consume(
      quota.execBucket,
      EXECUTIONS_PER_HOUR,
      ONE_HOUR_MS
    );
    if (!execResult.ok) {
      // Undo request token since we're denying
      quota.requestBucket.tokens = Math.min(
        REQUESTS_PER_MINUTE,
        quota.requestBucket.tokens + 1
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(execResult.retryAfterMs / 1_000),
        remaining: remaining(quota),
      };
    }
  }

  // ── Daily token check ─────────────────────────────────────────────────────
  if (options.llmTokensUsed && options.llmTokensUsed > 0) {
    const tokenResult = consume(
      quota.tokenBucket,
      TOKENS_PER_DAY,
      ONE_DAY_MS,
      options.llmTokensUsed
    );
    if (!tokenResult.ok) {
      // Undo consumed tokens
      quota.requestBucket.tokens = Math.min(
        REQUESTS_PER_MINUTE,
        quota.requestBucket.tokens + 1
      );
      if (options.isExecution) {
        quota.execBucket.tokens = Math.min(
          EXECUTIONS_PER_HOUR,
          quota.execBucket.tokens + 1
        );
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(tokenResult.retryAfterMs / 1_000),
        remaining: remaining(quota),
      };
    }

    // Track usage for observability
    quota.tokenUsage.push([Date.now(), options.llmTokensUsed]);
    // Prune entries older than 24 h
    const cutoff = Date.now() - ONE_DAY_MS;
    quota.tokenUsage = quota.tokenUsage.filter(([ts]) => ts >= cutoff);
  }

  return { allowed: true, retryAfterSeconds: 0, remaining: remaining(quota) };
}

function remaining(quota: UserQuota) {
  refill(quota.requestBucket, REQUESTS_PER_MINUTE, ONE_MINUTE_MS);
  refill(quota.execBucket, EXECUTIONS_PER_HOUR, ONE_HOUR_MS);
  refill(quota.tokenBucket, TOKENS_PER_DAY, ONE_DAY_MS);
  return {
    requestsPerMinute: Math.floor(quota.requestBucket.tokens),
    executionsPerHour: Math.floor(quota.execBucket.tokens),
    tokensPerDay: Math.floor(quota.tokenBucket.tokens),
  };
}

/**
 * Get remaining quota for a user without consuming any tokens.
 */
export function getRemainingQuota(userId: string) {
  return remaining(getOrCreate(userId));
}

/**
 * Reset all rate limit data for a user (admin utility).
 */
export function resetRateLimit(userId: string): void {
  store.delete(userId);
}
