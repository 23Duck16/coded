# Phase 5: E2E Demo — Autonomous Dashboard Creation

## Overview

`POST /api/phase5` is the full end-to-end autonomous agent demo endpoint.  It
accepts a natural-language prompt and orchestrates the complete pipeline:

1. **Permission check** — Role-based access control (RBAC)
2. **Rate limit** — 10 requests per minute per user
3. **AI planning** — Claude breaks the request into ordered workflow steps
4. **File execution** — Each step is executed via `/api/agent` with auto-retry
5. **Output validation** — Ensures the generated files meet quality standards
6. **Audit logging** — Full execution trace returned in the response

---

## Quick Start

```bash
# Start the dev server
npm run dev

# Run the demo endpoint
curl -X POST http://localhost:3000/api/phase5 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a product catalog dashboard with CRUD and search",
    "userId": "demo-user"
  }'
```

---

## Request Body

| Field    | Type   | Required | Default      | Description                             |
|----------|--------|----------|--------------|-----------------------------------------|
| `prompt` | string | ✅        | —            | Natural-language dashboard description  |
| `userId` | string | ❌        | `anonymous`  | User identifier for rate limiting       |
| `role`   | string | ❌        | `user`       | `admin` \| `user` \| `readonly`         |

---

## Success Response (200)

```json
{
  "success": true,
  "executionId": "exec-abc12345",
  "filesCreated": [
    "lib/models/Product.ts",
    "app/api/products/route.ts",
    "app/products/page.tsx",
    "app/products/form.tsx"
  ],
  "duration": 8500,
  "tokensUsed": 12400,
  "corrections": 2,
  "auditEvents": [
    { "action": "permission_check", "status": "success", "timestamp": "..." },
    { "action": "ai_planning",      "status": "success", "timestamp": "...", "tokensUsed": 4500 },
    { "action": "code_execution",   "status": "success", "timestamp": "...", "filesCreated": 4 },
    { "action": "auto_correction",  "status": "success", "timestamp": "...", "attempts": 2 },
    { "action": "output_validation","status": "success", "timestamp": "..." }
  ]
}
```

---

## Error Responses

| Status | Reason                                   |
|--------|------------------------------------------|
| 400    | Missing or invalid `prompt`              |
| 403    | Role does not have permission            |
| 429    | Rate limit exceeded (`Retry-After` set)  |
| 500    | Internal pipeline error                  |

---

## Example Prompts

### Product Catalog Dashboard

```json
{
  "prompt": "Create a product catalog dashboard with:\n- Database model for products (name, price, description, inventory)\n- API route for CRUD operations\n- React component with paginated table, search, and filters\n- Form modal for add/edit\n- Delete confirmation dialog",
  "userId": "alice"
}
```

### Blog Dashboard

```json
{
  "prompt": "Create a blog dashboard with post CRUD, comments, and analytics",
  "userId": "bob"
}
```

### User Management Dashboard

```json
{
  "prompt": "Create a user dashboard with profile editing, activity history, and settings panel",
  "userId": "carol",
  "role": "admin"
}
```

### E-Commerce Orders Dashboard

```json
{
  "prompt": "Create an orders dashboard showing recent orders, revenue metrics, and fulfillment status",
  "userId": "dave"
}
```

---

## Environment Variables

Add to your `.env.local`:

```env
# Disable the Phase 5 demo endpoint (optional)
PHASE5_DEMO_ENABLED=true

# Required for AI planning
ANTHROPIC_API_KEY=sk-ant-...

# App base URL for internal API calls
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Rate Limits

- **10 requests per minute** per `userId`
- When exceeded, the response is `429` with a `Retry-After: <seconds>` header

---

## Admin Queries

Each execution returns a unique `executionId` (e.g. `exec-abc12345`).  Use
this ID to correlate audit events, execution history, and generated files.

```bash
# Check endpoint info
curl http://localhost:3000/api/phase5
```

---

## Architecture

```
POST /api/phase5
      │
      ├─ checkRateLimit(userId)          → 429 if exceeded
      │
      ├─ runFullAgentPipeline(prompt, ctx)
      │     ├─ checkPermissions(role)    → 403 if denied
      │     ├─ POST /api/ai              → AI planning steps
      │     ├─ POST /api/agent × N       → Execute each step (auto-retry)
      │     └─ validateDashboardOutput() → Quality gate
      │
      └─ reportExecutionSummary()        → Structured JSON response
```

---

## Running Tests

```bash
npm test
```

The integration test suite (`__tests__/phase5.integration.test.ts`) covers:

- ✅ Full pipeline: prompt → plan → execute → success
- ✅ Auto-correction on failures (simulated)
- ✅ Rate limiting enforcement
- ✅ Audit trail completeness
- ✅ Rollback on critical failures
- ✅ Token usage tracking
- ✅ Permission violation detection
- ✅ Admin execution history queries
