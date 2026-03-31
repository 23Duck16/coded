import Anthropic from "@anthropic-ai/sdk";
import type { AiPlanStep, AiRequest, AiResponse } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? "claude-3-5-sonnet-20241022";

const SYSTEM_PROMPT = `You are an expert software architect integrated into the CodeSpring app engine.
Your role is to decompose natural-language feature requests into ordered, executable workflow steps.

The CodeSpring engine supports the following step actions:
- apply_template: Apply a named template with parameter substitution
- create_file: Create a new file at a given path with content
- update_file: Update an existing file at a given path
- multi_step: Nest multiple steps inside a single step

Available template categories: crud, landing, dashboard, auth, api

When responding, you MUST return valid JSON in exactly this shape and nothing else:
{
  "steps": [
    {
      "name": "string — short human-readable step title",
      "action": "apply_template | create_file | update_file | multi_step",
      "template": "optional — template id, e.g. \\"crud/model\\"",
      "path": "optional — file path relative to repo root",
      "params": { "key": "value" }
    }
  ],
  "reasoning": "string — explanation of the decomposition strategy",
  "estimatedTime": "string — rough human estimate, e.g. \\"~5 min\\""
}

Follow CodeSpring conventions:
- Models live in lib/models/<name>.ts
- API routes live in app/api/<resource>/route.ts
- Pages live in app/<resource>/page.tsx
- Forms live in app/<resource>/form.tsx
- Use PascalCase for model names, kebab-case for paths`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserMessage(request: AiRequest): string {
  const lines: string[] = [`Task: ${request.prompt}`];

  if (request.context && Object.keys(request.context).length > 0) {
    lines.push(
      `\nRepository context:\n${JSON.stringify(request.context, null, 2)}`
    );
  }

  return lines.join("\n");
}

const VALID_ACTIONS = new Set<AiPlanStep["action"]>([
  "apply_template",
  "create_file",
  "update_file",
  "multi_step",
]);

function parseSteps(raw: string): AiResponse {
  // Extract the first JSON object from the response, ignoring any surrounding
  // markdown prose or code fences.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM response does not contain a JSON object");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    steps?: unknown;
    reasoning?: unknown;
    estimatedTime?: unknown;
  };

  if (!Array.isArray(parsed.steps)) {
    throw new Error("LLM response missing 'steps' array");
  }

  const steps: AiPlanStep[] = [];

  for (const s of parsed.steps as unknown[]) {
    const step = s as Record<string, unknown>;
    const action = step.action as string | undefined;

    if (!action || !VALID_ACTIONS.has(action as AiPlanStep["action"])) {
      console.warn(
        `[lib/ai] Skipping step with unrecognized action '${String(action)}'`
      );
      continue;
    }

    steps.push({
      name: String(step.name ?? ""),
      action: action as AiPlanStep["action"],
      template: step.template !== undefined ? String(step.template) : undefined,
      path: step.path !== undefined ? String(step.path) : undefined,
      params:
        step.params !== null &&
        typeof step.params === "object" &&
        !Array.isArray(step.params)
          ? (step.params as Record<string, string>)
          : undefined,
    });
  }

  return {
    steps,
    reasoning: String(parsed.reasoning ?? ""),
    estimatedTime:
      parsed.estimatedTime !== undefined
        ? String(parsed.estimatedTime)
        : undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a natural-language planning request to Claude and return structured
 * workflow steps.
 *
 * Throws if ANTHROPIC_API_KEY is not set or the API call fails.
 */
export async function planWithClaude(request: AiRequest): Promise<AiResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env.local file."
    );
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(request) }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude API");
  }

  return parseSteps(content.text);
}
