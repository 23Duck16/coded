import { NextRequest, NextResponse } from "next/server";
import { runWorkflow } from "@/lib/workflow";
import type { WorkflowRequest, WorkflowResponse } from "@/lib/types";

/**
 * POST /api/workflow
 *
 * Accepts a high-level workflow name and parameters, decomposes it into
 * ordered steps, and executes each one via the Agent layer.
 *
 * Example body:
 * {
 *   "workflow": "create_crud_feature",
 *   "params": { "model_name": "Case", "fields": "title,status,description" },
 *   "deploy": false
 * }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<WorkflowResponse>> {
  let body: WorkflowRequest;

  try {
    body = (await req.json()) as WorkflowRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        workflow: "" as WorkflowRequest["workflow"],
        completedSteps: 0,
        totalSteps: 0,
        steps: [],
        error: "Invalid JSON body",
      },
      { status: 400 }
    );
  }

  if (!body.workflow) {
    return NextResponse.json(
      {
        success: false,
        workflow: "" as WorkflowRequest["workflow"],
        completedSteps: 0,
        totalSteps: 0,
        steps: [],
        error: "Missing required field: workflow",
      },
      { status: 400 }
    );
  }

  try {
    const result = await runWorkflow(body);
    const status = result.success ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[api/workflow] Unhandled error:", err);
    return NextResponse.json(
      {
        success: false,
        workflow: body.workflow,
        completedSteps: 0,
        totalSteps: 0,
        steps: [],
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: "Workflow API",
    version: "1.0.0",
    description: "High-level task router that decomposes tasks into agent steps",
    workflows: [
      {
        name: "create_crud_feature",
        params: ["model_name", "fields"],
        description: "Scaffold schema, API route, list page, and form for a model",
      },
      {
        name: "create_landing_page",
        params: ["page_path", "entity_description"],
        description: "Generate a landing page at the given route",
      },
      {
        name: "add_dashboard_section",
        params: ["section_name", "entity_description"],
        description: "Add a new dashboard section page",
      },
    ],
    usage: "POST /api/workflow with { workflow, params, deploy? }",
  });
}
