import { NextRequest, NextResponse } from "next/server";
import type { DeployRequest, DeployResponse } from "@/lib/types";

/**
 * POST /api/deploy
 *
 * Triggers a Vercel deployment via a deploy hook URL stored in
 * VERCEL_DEPLOY_HOOK_URL environment variable.
 *
 * Example body:
 * { "reason": "Workflow: create_crud_feature" }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<DeployResponse>> {
  let body: DeployRequest = {};

  try {
    body = (await req.json()) as DeployRequest;
  } catch {
    // Body is optional for deploy — ignore parse errors
  }

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return NextResponse.json(
      {
        success: false,
        message: "VERCEL_DEPLOY_HOOK_URL is not configured",
        error: "VERCEL_DEPLOY_HOOK_URL is not configured",
      },
      { status: 503 }
    );
  }

  try {
    console.log(
      `[api/deploy] Triggering deployment. Reason: ${body.reason ?? "manual"}`
    );

    const vercelRes = await fetch(hookUrl, { method: "POST" });

    if (!vercelRes.ok) {
      const text = await vercelRes.text();
      return NextResponse.json(
        {
          success: false,
          message: `Vercel responded with ${vercelRes.status}`,
          error: text,
        },
        { status: 502 }
      );
    }

    const data = (await vercelRes.json()) as { job?: { url?: string } };
    const deploymentUrl = data?.job?.url;

    return NextResponse.json({
      success: true,
      message: "Deployment triggered successfully",
      deploymentUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[api/deploy] Error:", err);
    return NextResponse.json(
      { success: false, message, error: message },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  const configured = Boolean(process.env.VERCEL_DEPLOY_HOOK_URL);
  return NextResponse.json({
    name: "Deploy API",
    version: "1.0.0",
    description: "Triggers a Vercel deployment via a deploy hook",
    configured,
    usage: "POST /api/deploy with optional { reason: string }",
  });
}
