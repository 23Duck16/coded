import fs from "fs";
import path from "path";
import { renderTemplate } from "./templates";
import type {
  AgentRequest,
  AgentResponse,
  AgentStepResult,
} from "./types";

const REPO_ROOT = process.cwd();

/**
 * Execute a single agent instruction and return a structured result.
 */
export async function runAgent(request: AgentRequest): Promise<AgentResponse> {
  const results: AgentStepResult[] = [];

  try {
    switch (request.action) {
      case "create_file": {
        const result = await actionCreateFile(request);
        results.push(result);
        break;
      }
      case "update_file": {
        const result = await actionUpdateFile(request);
        results.push(result);
        break;
      }
      case "apply_template": {
        const result = await actionApplyTemplate(request);
        results.push(result);
        break;
      }
      case "multi_step": {
        const stepResults = await actionMultiStep(request);
        results.push(...stepResults);
        break;
      }
      default: {
        const unknownAction = (request as AgentRequest).action;
        results.push({
          action: unknownAction,
          success: false,
          message: `Unknown action: ${unknownAction}`,
          error: `Unknown action: ${unknownAction}`,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      action: request.action,
      target_path: request.target_path,
      success: false,
      message: `Unexpected error: ${message}`,
      error: message,
    });
  }

  const allSucceeded = results.every((r) => r.success);
  return {
    success: allSucceeded,
    message: allSucceeded
      ? `Completed ${results.length} step(s) successfully`
      : `Some steps failed (${results.filter((r) => !r.success).length} error(s))`,
    results,
  };
}

// ─── Action Handlers ──────────────────────────────────────────────────────────

async function actionCreateFile(request: AgentRequest): Promise<AgentStepResult> {
  const { target_path, content, description } = request;

  if (!target_path) {
    return failure("create_file", undefined, "target_path is required");
  }

  const absPath = resolveRepoPath(target_path);
  if (fs.existsSync(absPath)) {
    return {
      action: "create_file",
      target_path,
      success: true,
      message: `File already exists (skipping): ${target_path}`,
    };
  }

  ensureDir(absPath);
  fs.writeFileSync(absPath, content ?? "", "utf-8");
  log(`[agent] created: ${target_path}`, description);

  return {
    action: "create_file",
    target_path,
    success: true,
    message: `Created: ${target_path}`,
  };
}

async function actionUpdateFile(request: AgentRequest): Promise<AgentStepResult> {
  const { target_path, content, description } = request;

  if (!target_path) {
    return failure("update_file", undefined, "target_path is required");
  }
  if (content === undefined) {
    return failure("update_file", target_path, "content is required for update_file");
  }

  const absPath = resolveRepoPath(target_path);
  ensureDir(absPath);
  fs.writeFileSync(absPath, content, "utf-8");
  log(`[agent] updated: ${target_path}`, description);

  return {
    action: "update_file",
    target_path,
    success: true,
    message: `Updated: ${target_path}`,
  };
}

async function actionApplyTemplate(request: AgentRequest): Promise<AgentStepResult> {
  const { target_path, template_name, params = {}, description } = request;

  if (!target_path) {
    return failure("apply_template", undefined, "target_path is required");
  }
  if (!template_name) {
    return failure("apply_template", target_path, "template_name is required");
  }

  // Derive the template file name from the last segment of target_path extension
  // Convention: templates/<template_name>/template.<ext>
  const ext = path.extname(target_path).replace(".", "") || "ts";
  const templateFileName = `template.${ext}`;

  let rendered: string;
  try {
    rendered = renderTemplate(template_name, templateFileName, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure("apply_template", target_path, msg);
  }

  const absPath = resolveRepoPath(target_path);
  ensureDir(absPath);
  fs.writeFileSync(absPath, rendered, "utf-8");
  log(`[agent] applied template '${template_name}' → ${target_path}`, description);

  return {
    action: "apply_template",
    target_path,
    success: true,
    message: `Applied template '${template_name}' to: ${target_path}`,
  };
}

async function actionMultiStep(request: AgentRequest): Promise<AgentStepResult[]> {
  const steps = request.steps ?? [];
  const results: AgentStepResult[] = [];

  for (const step of steps) {
    const stepRequest: AgentRequest = {
      action: "create_file",
      ...step,
    };

    const response = await runAgent(stepRequest);
    results.push(...response.results);

    // Stop on first failure
    if (!response.success) break;
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRepoPath(relativePath: string): string {
  // Prevent path traversal outside the repo root
  const resolved = path.resolve(REPO_ROOT, relativePath);
  if (!resolved.startsWith(REPO_ROOT)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}

function ensureDir(absFilePath: string): void {
  const dir = path.dirname(absFilePath);
  fs.mkdirSync(dir, { recursive: true });
}

function failure(
  action: string,
  target_path: string | undefined,
  error: string
): AgentStepResult {
  return { action, target_path, success: false, message: error, error };
}

function log(msg: string, description?: string): void {
  const prefix = description ? `[${description}] ` : "";
  console.log(`${prefix}${msg}`);
}
