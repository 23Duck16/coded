# How the Engine Works

The **Coded App Engine** is a self-contained scaffold engine built on Next.js.  
It has three HTTP API layers that work together to scaffold code features into the repository.

---

## Architecture Overview

```
Request
   │
   ▼
┌──────────────────────────────────┐
│   Workflow Layer  /api/workflow  │  ← High-level task router
│                                  │
│  create_crud_feature             │
│  create_landing_page             │
│  add_dashboard_section           │
└────────────┬─────────────────────┘
             │ calls
             ▼
┌──────────────────────────────────┐
│   Agent Layer     /api/agent     │  ← Repo-aware file operator
│                                  │
│  create_file                     │
│  update_file                     │
│  apply_template                  │
│  multi_step                      │
└────────────┬─────────────────────┘
             │ reads
             ▼
┌──────────────────────────────────┐
│   Template System  /templates/   │  ← Reusable code starters
│                                  │
│  crud/  landing/  dashboard/     │
│  auth/  api/  metadata.json      │
└──────────────────────────────────┘
             │
             │ (optionally after steps)
             ▼
┌──────────────────────────────────┐
│   Deploy Layer    /api/deploy    │  ← Vercel hook trigger
└──────────────────────────────────┘
```

---

## Workflow Layer

**Endpoint:** `POST /api/workflow`

Accepts a high-level workflow name and parameters.  
Decomposes the task into sequential **agent steps**, executes them in order,
and collects results.

### Request

```json
{
  "workflow": "create_crud_feature",
  "params": {
    "model_name": "Case",
    "fields": "title,status,description"
  },
  "deploy": false
}
```

### Response

```json
{
  "success": true,
  "workflow": "create_crud_feature",
  "completedSteps": 4,
  "totalSteps": 4,
  "steps": [
    { "step": 1, "name": "generate_schema", "success": true, "message": "..." },
    ...
  ]
}
```

---

## Agent Layer

**Endpoint:** `POST /api/agent`

Performs low-level file operations:

| Action | Description |
|--------|-------------|
| `create_file` | Creates a new file (skips if already exists) |
| `update_file` | Overwrites a file with provided content |
| `apply_template` | Loads a template, substitutes params, writes to target_path |
| `multi_step` | Runs multiple agent steps sequentially |

### Request — create_file

```json
{
  "action": "create_file",
  "target_path": "app/hello/page.tsx",
  "content": "export default function Hello() { return <h1>Hello</h1>; }",
  "description": "Add hello page"
}
```

### Request — apply_template

```json
{
  "action": "apply_template",
  "target_path": "app/api/case/route.ts",
  "template_name": "api",
  "params": {
    "MODEL_NAME": "Case",
    "MODEL_SLUG": "case",
    "FIELDS": "title,status"
  },
  "description": "Scaffold Case API route"
}
```

---

## Template System

Templates live in `/templates/<name>/` and contain one or more template files.

- Placeholders use `{{UPPER_SNAKE_CASE}}` syntax (e.g. `{{MODEL_NAME}}`)
- The template file name must match the extension of `target_path`
  (e.g. `.ts` → `template.ts`, `.tsx` → `template.tsx`)
- `templates/metadata.json` is the template catalog

---

## Deploy Layer

**Endpoint:** `POST /api/deploy`

Triggers a Vercel deployment via the `VERCEL_DEPLOY_HOOK_URL` environment variable.

```json
{ "reason": "Workflow: create_crud_feature" }
```

Set `VERCEL_DEPLOY_HOOK_URL` in your `.env.local` to enable this.

---

## Dashboard UI

Visit `/` to access the interactive dashboard where you can run workflows and
agent actions directly from the browser.
