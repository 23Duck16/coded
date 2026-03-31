// ─── Agent Types ──────────────────────────────────────────────────────────────

export type AgentAction =
  | "create_file"
  | "update_file"
  | "apply_template"
  | "multi_step";

export interface AgentRequest {
  action: AgentAction;
  /** Destination path relative to repo root (e.g. "app/models/case.ts") */
  target_path?: string;
  /** Name of the template to load from /templates/<template_name> */
  template_name?: string;
  /** Arbitrary key-value parameters used for placeholder substitution */
  params?: Record<string, string>;
  /** Human-readable description of the change (used as commit message) */
  description?: string;
  /** Raw content — used by create_file / update_file when no template */
  content?: string;
  /** Ordered steps for multi_step action */
  steps?: Omit<AgentRequest, "action" | "steps">[];
}

export interface AgentStepResult {
  action: string;
  target_path?: string;
  success: boolean;
  message: string;
  error?: string;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  results: AgentStepResult[];
  error?: string;
}

// ─── Template Types ───────────────────────────────────────────────────────────

export interface TemplateParam {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface TemplateMetadata {
  name: string;
  description: string;
  category: "crud" | "landing" | "dashboard" | "auth" | "api" | string;
  /** Relative path inside /templates directory */
  path: string;
  params: TemplateParam[];
  /** Files produced by this template (relative to template dir) */
  files: string[];
}

export interface TemplateCatalog {
  version: string;
  templates: TemplateMetadata[];
}

// ─── Workflow Types ───────────────────────────────────────────────────────────

export type WorkflowName =
  | "create_crud_feature"
  | "create_landing_page"
  | "add_dashboard_section";

export interface WorkflowRequest {
  workflow: WorkflowName;
  params: Record<string, string>;
  /** If true, trigger a deployment after all steps succeed */
  deploy?: boolean;
}

export interface WorkflowStepResult {
  step: number;
  name: string;
  success: boolean;
  message: string;
  agentResult?: AgentResponse;
  error?: string;
}

export interface WorkflowResponse {
  success: boolean;
  workflow: WorkflowName;
  completedSteps: number;
  totalSteps: number;
  steps: WorkflowStepResult[];
  deploymentUrl?: string;
  error?: string;
}

export interface WorkflowContext {
  workflow: WorkflowName;
  params: Record<string, string>;
  results: WorkflowStepResult[];
}

export type WorkflowStep = (
  context: WorkflowContext
) => Promise<WorkflowStepResult>;

// ─── Deploy Types ─────────────────────────────────────────────────────────────

export interface DeployRequest {
  /** Optional human-readable reason for the deployment */
  reason?: string;
}

export interface DeployResponse {
  success: boolean;
  message: string;
  deploymentUrl?: string;
  error?: string;
}

// ─── Phase 5 / Pipeline Types ─────────────────────────────────────────────────

export interface AuditEvent {
  action: string;
  status: "success" | "failure" | "skipped";
  timestamp: string;
  tokensUsed?: number;
  filesCreated?: number;
  attempts?: number;
  details?: Record<string, unknown>;
}

export interface Phase5Request {
  /** Natural-language description of the dashboard to create */
  prompt: string;
  /** Optional user identifier for rate limiting and audit logging */
  userId?: string;
  /** Optional role for permission checks (default: "user") */
  role?: "admin" | "user" | "readonly";
}

export interface Phase5Response {
  success: boolean;
  executionId: string;
  filesCreated: string[];
  duration: number;
  tokensUsed: number;
  corrections: number;
  auditEvents: AuditEvent[];
  error?: string;
}

export interface PipelineExecutionResult {
  executionId: string;
  prompt: string;
  userId: string;
  role: string;
  startTime: number;
  endTime?: number;
  filesCreated: string[];
  tokensUsed: number;
  corrections: number;
  auditEvents: AuditEvent[];
  success: boolean;
  error?: string;
}

// ─── AI / LLM Types ───────────────────────────────────────────────────────────

export type AiModel = "claude" | "gpt4";

export interface AiPlanStep {
  name: string;
  action: "apply_template" | "create_file" | "update_file" | "multi_step";
  template?: string;
  path?: string;
  params?: Record<string, string>;
}

export interface AiRequest {
  /** Natural-language task description */
  prompt: string;
  /** Optional structured context injected into the system prompt */
  context?: Record<string, unknown>;
  /** LLM backend to use (default: "claude") */
  model?: AiModel;
}

export interface AiResponse {
  steps: AiPlanStep[];
  reasoning: string;
  estimatedTime?: string;
  /** Tracking context injected by demo pipeline (Phase 5) */
  dauthContext?: Record<string, unknown>;
  error?: string;
}
