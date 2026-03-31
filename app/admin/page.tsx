"use client";

/**
 * app/admin/page.tsx
 *
 * Admin dashboard — shows execution history, audit events, and quota usage.
 * Accessible only to users with the admin role (enforced on the API side).
 */

import { useEffect, useState, useCallback } from "react";
import type { ExecutionRecord, AuditEvent } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryResponse {
  records: ExecutionRecord[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: ExecutionRecord["status"]) {
  const colours: Record<string, string> = {
    success: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    running: "bg-blue-100 text-blue-800",
    pending: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${colours[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

function resultBadge(result: AuditEvent["result"]) {
  const colours: Record<string, string> = {
    success: "bg-green-100 text-green-800",
    failure: "bg-red-100 text-red-800",
    denied: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${colours[result] ?? "bg-gray-100 text-gray-700"}`}
    >
      {result}
    </span>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);
  const fetchData = useCallback(async (jwt: string) => {
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${jwt}` };

      const [histRes, auditRes] = await Promise.all([
        fetch("/api/history?limit=50", { headers }),
        fetch("/api/audit?limit=50", { headers }),
      ]);

      if (!histRes.ok) {
        const body = (await histRes.json()) as { error?: string };
        throw new Error(body.error ?? `History fetch failed (${histRes.status})`);
      }

      const histData = (await histRes.json()) as HistoryResponse;
      setHistory(histData.records ?? []);

      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as { events: AuditEvent[] };
        setAuditEvents(auditData.events ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) fetchData(token);
  }, [token, fetchData]);

  async function handleRollback(id: string) {
    setRollbackStatus(null);
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, action: "rollback" }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      setRollbackStatus(data.message ?? data.error ?? "Done");
      if (res.ok) fetchData(token);
    } catch (err) {
      setRollbackStatus(err instanceof Error ? err.message : "Rollback failed");
    }
  }

  // ── Login form ──────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">Admin Login</h1>
          <p className="mb-4 text-sm text-gray-500">
            Enter your admin JWT to access the dashboard.
          </p>
          <input
            type="password"
            className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Bearer token…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button
            className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={() => setToken(tokenInput.trim())}
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <div className="flex gap-3">
            <button
              onClick={() => fetchData(token)}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Refresh
            </button>
            <button
              onClick={() => setToken("")}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Status messages */}
        {loading && (
          <div className="mb-4 rounded bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Loading…
          </div>
        )}
        {error && (
          <div className="mb-4 rounded bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {rollbackStatus && (
          <div className="mb-4 rounded bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
            Rollback: {rollbackStatus}
          </div>
        )}

        {/* Execution History */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-semibold text-gray-800">
            Execution History ({history.length})
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No executions recorded yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">
                        {fmt(rec.timestamp)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700">
                        {rec.userId}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{rec.type}</td>
                      <td className="px-4 py-3">{statusBadge(rec.status)}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {rec.durationMs != null
                          ? `${rec.durationMs} ms`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {rec.rollbackSnapshot &&
                          Object.keys(rec.rollbackSnapshot).length > 0 && (
                            <button
                              onClick={() => handleRollback(rec.id)}
                              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              Rollback
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Audit Events */}
        {auditEvents.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-semibold text-gray-800">
              Recent Audit Events ({auditEvents.length})
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Resource</th>
                    <th className="px-4 py-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">
                        {fmt(ev.timestamp)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700">
                        {ev.type}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{ev.userId}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {ev.resource ?? "—"}
                      </td>
                      <td className="px-4 py-3">{resultBadge(ev.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
