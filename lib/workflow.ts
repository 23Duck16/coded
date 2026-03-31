import type {
  WorkflowContext,
  WorkflowName,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowStep,
  WorkflowStepResult,
} from "./types";
import { runAgent } from "./agent";

// ─── Workflow Registry ────────────────────────────────────────────────────────

const WORKFLOW_REGISTRY: Record<WorkflowName, WorkflowStep[]> = {
  create_crud_feature: createCrudFeatureSteps(),
  create_landing_page: createLandingPageSteps(),
  add_dashboard_section: addDashboardSectionSteps(),
};

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Execute a named workflow end-to-end, collecting results for each step.
 */
export async function runWorkflow(
  request: WorkflowRequest
): Promise<WorkflowResponse> {
  const { workflow, params, deploy = false } = request;

  const steps = WORKFLOW_REGISTRY[workflow];
  if (!steps) {
    return {
      success: false,
      workflow,
      completedSteps: 0,
      totalSteps: 0,
      steps: [],
      error: `Unknown workflow: ${workflow}`,
    };
  }

  const context: WorkflowContext = { workflow, params, results: [] };
  const stepResults: WorkflowStepResult[] = [];
  let completedSteps = 0;

  for (let i = 0; i < steps.length; i++) {
    const stepFn = steps[i];
    let result: WorkflowStepResult;

    try {
      result = await stepFn(context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        step: i + 1,
        name: `step_${i + 1}`,
        success: false,
        message: msg,
        error: msg,
      };
    }

    result.step = i + 1;
    stepResults.push(result);
    context.results.push(result);

    if (!result.success) {
      return {
        success: false,
        workflow,
        completedSteps,
        totalSteps: steps.length,
        steps: stepResults,
        error: result.error ?? result.message,
      };
    }

    completedSteps++;
  }

  // Optionally trigger deployment
  let deploymentUrl: string | undefined;
  if (deploy) {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const deployRes = await fetch(`${appUrl}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: `Workflow: ${workflow}` }),
      });
      const deployData = (await deployRes.json()) as { deploymentUrl?: string };
      deploymentUrl = deployData.deploymentUrl;
    } catch {
      // Non-fatal: workflow succeeded, deployment is best-effort
      console.warn("[workflow] Deployment trigger failed (non-fatal)");
    }
  }

  return {
    success: true,
    workflow,
    completedSteps,
    totalSteps: steps.length,
    steps: stepResults,
    deploymentUrl,
  };
}

// ─── Workflow Definitions ─────────────────────────────────────────────────────

/**
 * create_crud_feature
 * Required params: model_name (e.g. "Case"), fields (comma-separated e.g. "title,status,description")
 */
function createCrudFeatureSteps(): WorkflowStep[] {
  return [
    // Step 1: Generate schema / type file
    async (ctx) => {
      const { model_name = "Item", fields = "name" } = ctx.params;
      const modelSlug = toSlug(model_name);
      const fieldsTyped = fields
        .split(",")
        .map((f) => `  ${f.trim()}: string;`)
        .join("\n");
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `lib/models/${modelSlug}.ts`,
        template_name: "crud",
        params: {
          MODEL_NAME: model_name,
          FIELDS: fields,
          MODEL_SLUG: modelSlug,
          FIELDS_TYPED: fieldsTyped,
        },
        description: `Generate schema for ${model_name}`,
      });
      return stepResult(1, "generate_schema", agentResult);
    },

    // Step 2: Generate API route
    async (ctx) => {
      const { model_name = "Item", fields = "name" } = ctx.params;
      const modelSlug = toSlug(model_name);
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/api/${modelSlug}/route.ts`,
        template_name: "api",
        params: { MODEL_NAME: model_name, FIELDS: fields, MODEL_SLUG: modelSlug },
        description: `Generate API route for ${model_name}`,
      });
      return stepResult(2, "generate_api_route", agentResult);
    },

    // Step 3: Generate listing UI page
    async (ctx) => {
      const { model_name = "Item" } = ctx.params;
      const modelSlug = toSlug(model_name);
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/${modelSlug}/page.tsx`,
        template_name: "crud",
        params: { MODEL_NAME: model_name, MODEL_SLUG: modelSlug },
        description: `Generate list page for ${model_name}`,
      });
      return stepResult(3, "generate_list_page", agentResult);
    },

    // Step 4: Generate create/edit form
    async (ctx) => {
      const { model_name = "Item", fields = "name" } = ctx.params;
      const modelSlug = toSlug(model_name);
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/${modelSlug}/form.tsx`,
        template_name: "crud",
        params: { MODEL_NAME: model_name, FIELDS: fields, MODEL_SLUG: modelSlug },
        description: `Generate form for ${model_name}`,
      });
      return stepResult(4, "generate_form", agentResult);
    },
  ];
}

/**
 * create_landing_page
 * Required params: page_path (e.g. "about"), entity_description
 */
function createLandingPageSteps(): WorkflowStep[] {
  return [
    async (ctx) => {
      const { page_path = "landing", entity_description = "Welcome" } = ctx.params;
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/${page_path}/page.tsx`,
        template_name: "landing",
        params: {
          PAGE_PATH: page_path,
          ENTITY_DESCRIPTION: entity_description,
          PAGE_TITLE: toTitle(page_path),
        },
        description: `Generate landing page at /${page_path}`,
      });
      return stepResult(1, "generate_landing_page", agentResult);
    },
  ];
}

/**
 * add_dashboard_section
 * Required params: section_name, entity_description
 */
function addDashboardSectionSteps(): WorkflowStep[] {
  return [
    async (ctx) => {
      const { section_name = "Section", entity_description = "Dashboard section" } =
        ctx.params;
      const sectionSlug = toSlug(section_name);
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/dashboard/${sectionSlug}/page.tsx`,
        template_name: "dashboard",
        params: {
          SECTION_NAME: section_name,
          SECTION_SLUG: sectionSlug,
          ENTITY_DESCRIPTION: entity_description,
        },
        description: `Generate dashboard section: ${section_name}`,
      });
      return stepResult(1, "generate_dashboard_section", agentResult);
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function toTitle(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function stepResult(
  step: number,
  name: string,
  agentResult: Awaited<ReturnType<typeof runAgent>>
): WorkflowStepResult {
  return {
    step,
    name,
    success: agentResult.success,
    message: agentResult.message,
    agentResult,
    error: agentResult.success ? undefined : agentResult.error,
  };
}
