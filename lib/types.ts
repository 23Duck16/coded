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
