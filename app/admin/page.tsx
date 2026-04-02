"use client";

/**
 * app/admin/page.tsx
 *
 * Admin dashboard — shows execution history, audit events, and quota usage.
 * Accessible only to users with the admin role (enforced on the API side).
 */

import { useEffect, useState, useCallback } from "react";
import { useState, useEffect, useCallback } from "react";
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
interface Stats {
  totalExecutions: number;
  successCount: number;
  avgExecutionTime: number;
  totalFilesCreated: number;
  totalTokensUsed: number;
}

interface HistoryResponse {
  executions: ExecutionRecord[];
  userId: string;
  limit: number;
  offset: number;
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
  const [userId, setUserId] = useState("anonymous");
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<"history" | "audit" | "stats">(
    "history"
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  );

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/history?userId=${encodeURIComponent(userId)}&limit=100`,
        { headers: authHeaders() }
      );
      const data = (await res.json()) as HistoryResponse | { error: string };
      if ("error" in data) throw new Error(data.error);
      setExecutions(data.executions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }, [userId, authHeaders]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/history?userId=${encodeURIComponent(userId)}&stats=true`,
        { headers: authHeaders() }
      );
      const data = (await res.json()) as Stats | { error: string };
      if ("error" in data) throw new Error((data as { error: string }).error);
      setStats(data as Stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  }, [userId, authHeaders]);

  const fetchAuditLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/audit?userId=${encodeURIComponent(userId)}&limit=100`,
        { headers: authHeaders() }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error ?? "Failed to fetch audit log");
      }
      const data = (await res.json()) as AuditEvent[];
      setAuditLog(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch audit log"
      );
    } finally {
      setLoading(false);
    }
  }, [userId, authHeaders]);

  useEffect(() => {
    if (activeTab === "history") void fetchHistory();
    else if (activeTab === "stats") void fetchStats();
    else if (activeTab === "audit") void fetchAuditLog();
  }, [activeTab, fetchHistory, fetchStats, fetchAuditLog]);

  async function handleRollback(executionId: string) {
    if (!confirm(`Rollback execution ${executionId}? This will delete created files.`))
      return;
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ executionId }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Rollback failed");
      alert("Rollback successful");
      void fetchHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rollback failed");
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6">🛡️ Agent Admin Dashboard</h1>

      {/* Auth + User Filter */}
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Bearer Token (optional)
          </label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
            placeholder="eyJ..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">User ID</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            placeholder="anonymous"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
      </section>

      {/* Tabs */}
      <nav className="flex gap-2 mb-6">
        {(["history", "stats", "audit"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded capitalize text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <p className="text-gray-400 text-sm mb-4">Loading…</p>
      )}

      {/* Execution History */}
      {activeTab === "history" && !loading && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Execution History ({executions.length})
          </h2>
          {executions.length === 0 ? (
            <p className="text-gray-500 text-sm">No executions recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-left">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Timestamp</th>
                    <th className="py-2 pr-4">Files</th>
                    <th className="py-2 pr-4">Tokens</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((rec) => (
                    <tr
                      key={rec.id}
                      className="border-b border-gray-800 hover:bg-gray-900"
                    >
                      <td className="py-2 pr-4 font-mono text-xs text-gray-400">
                        {rec.id.slice(0, 8)}…
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={rec.status} />
                      </td>
                      <td className="py-2 pr-4 text-gray-400">
                        {new Date(rec.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{rec.filesCreated.length}</td>
                      <td className="py-2 pr-4">{rec.tokensUsed}</td>
                      <td className="py-2">
                        <button
                          onClick={() => void handleRollback(rec.id)}
                          className="text-xs bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded"
                        >
                          Rollback
                        </button>
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
        </div>
      )}

      {/* Stats */}
      {activeTab === "stats" && !loading && stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Total Executions" value={stats.totalExecutions} />
          <StatCard label="Successful" value={stats.successCount} />
          <StatCard
            label="Avg Duration (ms)"
            value={Math.round(stats.avgExecutionTime)}
          />
          <StatCard label="Files Created" value={stats.totalFilesCreated} />
          <StatCard label="Tokens Used" value={stats.totalTokensUsed} />
          <StatCard
            label="Success Rate"
            value={
              stats.totalExecutions > 0
                ? `${Math.round((stats.successCount / stats.totalExecutions) * 100)}%`
                : "N/A"
            }
          />
        </div>
      )}

      {/* Audit Log */}
      {activeTab === "audit" && !loading && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Audit Log ({auditLog.length})
          </h2>
          {auditLog.length === 0 ? (
            <p className="text-gray-500 text-sm">No audit events recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-left">
                    <th className="py-2 pr-4">Timestamp</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Resource</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((ev) => (
                    <tr
                      key={ev.id}
                      className="border-b border-gray-800 hover:bg-gray-900"
                    >
                      <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {ev.action}
                      </td>
                      <td className="py-2 pr-4 text-gray-400">{ev.resource}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={ev.status} />
                      </td>
                      <td className="py-2 text-xs text-gray-500 max-w-xs truncate">
                        {JSON.stringify(ev.details)}
                      </td>
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
          )}
        </div>
      )}
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: "success" | "failure" | "partial" | "partial_success" | "failed";
}) {
  const colors: Record<string, string> = {
    success: "bg-green-700 text-green-100",
    failure: "bg-red-800 text-red-100",
    failed: "bg-red-800 text-red-100",
    partial: "bg-yellow-700 text-yellow-100",
    partial_success: "bg-yellow-700 text-yellow-100",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-700 text-gray-100"}`}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
