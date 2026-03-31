"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowForm {
  workflow: string;
  params: string;
  deploy: boolean;
}

interface AgentForm {
  action: string;
  target_path: string;
  content: string;
  template_name: string;
  params: string;
  description: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm>({
    workflow: "create_crud_feature",
    params: JSON.stringify({ model_name: "Case", fields: "title,status,description" }, null, 2),
    deploy: false,
  });

  const [agentForm, setAgentForm] = useState<AgentForm>({
    action: "create_file",
    target_path: "app/hello/page.tsx",
    content: 'export default function Hello() {\n  return <h1>Hello World</h1>;\n}\n',
    template_name: "",
    params: "{}",
    description: "Add hello page",
  });

  const [workflowResult, setWorkflowResult] = useState<unknown>(null);
  const [agentResult, setAgentResult] = useState<unknown>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);

  // ── Workflow submit ──
  const handleWorkflowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorkflowLoading(true);
    setWorkflowResult(null);
    try {
      let parsedParams: Record<string, string> = {};
      try {
        parsedParams = JSON.parse(workflowForm.params) as Record<string, string>;
      } catch {
        setWorkflowResult({ error: "Invalid JSON in params field" });
        return;
      }
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: workflowForm.workflow,
          params: parsedParams,
          deploy: workflowForm.deploy,
        }),
      });
      const data: unknown = await res.json();
      setWorkflowResult(data);
    } catch (err) {
      setWorkflowResult({ error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setWorkflowLoading(false);
    }
  };

  // ── Agent submit ──
  const handleAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentLoading(true);
    setAgentResult(null);
    try {
      let parsedParams: Record<string, string> = {};
      try {
        parsedParams = JSON.parse(agentForm.params) as Record<string, string>;
      } catch {
        setAgentResult({ error: "Invalid JSON in params field" });
        return;
      }
      const body: Record<string, unknown> = {
        action: agentForm.action,
        description: agentForm.description,
        params: parsedParams,
      };
      if (agentForm.target_path) body.target_path = agentForm.target_path;
      if (agentForm.content) body.content = agentForm.content;
      if (agentForm.template_name) body.template_name = agentForm.template_name;

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json();
      setAgentResult(data);
    } catch (err) {
      setAgentResult({ error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Header */}
      <header
        style={{
          background: "#1e293b",
          color: "#fff",
          padding: "1rem 2rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <span style={{ fontSize: "1.5rem", fontWeight: 800 }}>⚡ Coded</span>
        <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
          CodeSpring-style App Engine
        </span>
        <nav style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
          <a href="/api/agent" style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Agent API
          </a>
          <a href="/api/workflow" style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Workflow API
          </a>
          <a href="/api/deploy" style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Deploy API
          </a>
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem" }}>
        {/* Hero */}
        <section style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>
            App Engine Dashboard
          </h1>
          <p style={{ color: "#64748b", marginTop: "0.75rem", fontSize: "1.1rem" }}>
            Run workflows and agent actions to scaffold features into this repo.
          </p>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "2rem",
          }}
        >
          {/* ── Workflow Panel ── */}
          <Panel title="🔄 Run Workflow" subtitle="Decompose a high-level task into ordered steps">
            <form onSubmit={handleWorkflowSubmit}>
              <Field label="Workflow">
                <select
                  value={workflowForm.workflow}
                  onChange={(e) =>
                    setWorkflowForm((p) => ({ ...p, workflow: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="create_crud_feature">create_crud_feature</option>
                  <option value="create_landing_page">create_landing_page</option>
                  <option value="add_dashboard_section">add_dashboard_section</option>
                </select>
              </Field>

              <Field label="Params (JSON)">
                <textarea
                  value={workflowForm.params}
                  onChange={(e) =>
                    setWorkflowForm((p) => ({ ...p, params: e.target.value }))
                  }
                  rows={5}
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem" }}
                />
              </Field>

              <Field label="">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                  <input
                    type="checkbox"
                    checked={workflowForm.deploy}
                    onChange={(e) =>
                      setWorkflowForm((p) => ({ ...p, deploy: e.target.checked }))
                    }
                  />
                  Trigger deployment after completion
                </label>
              </Field>

              <button type="submit" disabled={workflowLoading} style={btnStyle}>
                {workflowLoading ? "Running…" : "Run Workflow"}
              </button>
            </form>

            {workflowResult !== null && (
              <ResultBox result={workflowResult} />
            )}
          </Panel>

          {/* ── Agent Panel ── */}
          <Panel title="🤖 Run Agent Action" subtitle="Execute a single file operation directly">
            <form onSubmit={handleAgentSubmit}>
              <Field label="Action">
                <select
                  value={agentForm.action}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, action: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="create_file">create_file</option>
                  <option value="update_file">update_file</option>
                  <option value="apply_template">apply_template</option>
                </select>
              </Field>

              <Field label="Target Path">
                <input
                  type="text"
                  value={agentForm.target_path}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, target_path: e.target.value }))
                  }
                  placeholder="app/hello/page.tsx"
                  style={inputStyle}
                />
              </Field>

              <Field label="Content (for create/update)">
                <textarea
                  value={agentForm.content}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, content: e.target.value }))
                  }
                  rows={4}
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem" }}
                />
              </Field>

              <Field label="Template Name (for apply_template)">
                <input
                  type="text"
                  value={agentForm.template_name}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, template_name: e.target.value }))
                  }
                  placeholder="crud"
                  style={inputStyle}
                />
              </Field>

              <Field label="Params (JSON)">
                <textarea
                  value={agentForm.params}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, params: e.target.value }))
                  }
                  rows={2}
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem" }}
                />
              </Field>

              <Field label="Description">
                <input
                  type="text"
                  value={agentForm.description}
                  onChange={(e) =>
                    setAgentForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="What does this change do?"
                  style={inputStyle}
                />
              </Field>

              <button type="submit" disabled={agentLoading} style={btnStyle}>
                {agentLoading ? "Running…" : "Run Agent"}
              </button>
            </form>

            {agentResult !== null && <ResultBox result={agentResult} />}
          </Panel>
        </div>

        {/* Architecture overview */}
        <section style={{ marginTop: "3rem" }}>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#0f172a", marginBottom: "1rem" }}>
            Engine Architecture
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            {[
              {
                icon: "🤖",
                title: "Agent Layer",
                path: "/api/agent",
                desc: "File I/O, template application, multi-step execution",
              },
              {
                icon: "🔄",
                title: "Workflow Layer",
                path: "/api/workflow",
                desc: "High-level task decomposition into ordered agent steps",
              },
              {
                icon: "🚀",
                title: "Deploy Layer",
                path: "/api/deploy",
                desc: "Vercel deploy hook trigger with status feedback",
              },
              {
                icon: "📄",
                title: "Template System",
                path: "/templates",
                desc: "Reusable code templates with placeholder substitution",
              },
            ].map((card) => (
              <div
                key={card.title}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "1.25rem",
                }}
              >
                <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{card.icon}</div>
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>{card.title}</h3>
                <p style={{ margin: "0.4rem 0", color: "#64748b", fontSize: "0.8rem" }}>
                  {card.desc}
                </p>
                <a
                  href={card.path}
                  style={{ color: "#3b82f6", fontSize: "0.8rem", textDecoration: "none" }}
                >
                  {card.path} →
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "1.5rem",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: "0.25rem 0 1rem", color: "#64748b", fontSize: "0.85rem" }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      {label && (
        <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem", color: "#374151" }}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

function ResultBox({ result }: { result: unknown }) {
  const isSuccess =
    result !== null &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success: boolean }).success;

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        borderRadius: 8,
        background: isSuccess ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${isSuccess ? "#86efac" : "#fca5a5"}`,
        fontSize: "0.75rem",
        fontFamily: "monospace",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        maxHeight: 300,
        overflowY: "auto",
      }}
    >
      {JSON.stringify(result, null, 2)}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "0.4rem 0.6rem",
  fontSize: "0.875rem",
  boxSizing: "border-box",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.5rem 1.25rem",
  fontSize: "0.875rem",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "0.5rem",
};
