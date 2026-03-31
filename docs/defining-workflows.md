# Defining New Workflows

Workflows are multi-step tasks that call the Agent layer in sequence.

---

## 1. Define the Workflow Steps

Open `lib/workflow.ts` and add your workflow function:

```ts
function createMyFeatureSteps(): WorkflowStep[] {
  return [
    // Step 1
    async (ctx) => {
      const { my_param = "default" } = ctx.params;
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/${my_param}/page.tsx`,
        template_name: "my-template",
        params: { MY_PARAM: my_param },
        description: `Generate page for ${my_param}`,
      });
      return stepResult(1, "generate_page", agentResult);
    },

    // Step 2
    async (ctx) => {
      const { my_param = "default" } = ctx.params;
      const agentResult = await runAgent({
        action: "apply_template",
        target_path: `app/api/${my_param}/route.ts`,
        template_name: "api",
        params: { MODEL_NAME: my_param, MODEL_SLUG: my_param, FIELDS: "name" },
        description: `Generate API for ${my_param}`,
      });
      return stepResult(2, "generate_api", agentResult);
    },
  ];
}
```

## 2. Register the Workflow

Add to the `WorkflowName` union type in `lib/types.ts`:

```ts
export type WorkflowName =
  | "create_crud_feature"
  | "create_landing_page"
  | "add_dashboard_section"
  | "create_my_feature";   // ← add here
```

Then register it in the `WORKFLOW_REGISTRY` inside `lib/workflow.ts`:

```ts
const WORKFLOW_REGISTRY: Record<WorkflowName, WorkflowStep[]> = {
  create_crud_feature: createCrudFeatureSteps(),
  create_landing_page: createLandingPageSteps(),
  add_dashboard_section: addDashboardSectionSteps(),
  create_my_feature: createMyFeatureSteps(),   // ← add here
};
```

## 3. Update the API Route (optional)

For better discoverability, add your workflow to the GET handler in
`app/api/workflow/route.ts`:

```ts
{
  name: "create_my_feature",
  params: ["my_param"],
  description: "Description of what this workflow does",
},
```

## 4. Run the Workflow

```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "create_my_feature",
    "params": { "my_param": "orders" },
    "deploy": false
  }'
```

---

## Workflow Step Contract

Each step is an `async` function with this signature:

```ts
type WorkflowStep = (context: WorkflowContext) => Promise<WorkflowStepResult>;
```

The `context` object contains:
- `context.workflow` — the workflow name
- `context.params` — the raw params passed by the caller
- `context.results` — results from previous steps (for chaining)

If a step returns `success: false`, the workflow stops and returns an error.
