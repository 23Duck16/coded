# Local and Production Setup

---

## Prerequisites

- Node.js 18+
- npm 9+

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the values you need:

```
# Required only if you want to trigger Vercel deploys
VERCEL_DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyy

# Optional: base URL for internal workflow → deploy calls
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

### 4. Try an agent action

```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create_file",
    "target_path": "app/hello/page.tsx",
    "content": "export default function Hello() { return <h1>Hello!</h1>; }",
    "description": "Test agent"
  }'
```

### 5. Run a workflow

```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "create_crud_feature",
    "params": { "model_name": "Case", "fields": "title,status,description" },
    "deploy": false
  }'
```

---

## Production (Vercel)

### 1. Push to GitHub

```bash
git push origin main
```

### 2. Import into Vercel

- Go to [vercel.com/new](https://vercel.com/new)
- Import this repository
- Vercel auto-detects Next.js

### 3. Set environment variables

In the Vercel dashboard → Project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `VERCEL_DEPLOY_HOOK_URL` | Your Vercel deploy hook URL |
| `NEXT_PUBLIC_APP_URL` | Your production URL (e.g. `https://coded.vercel.app`) |

### 4. Deploy

Vercel deploys automatically on every push to `main`.

---

## Type Checking and Linting

```bash
npm run type-check   # TypeScript compilation check
npm run lint         # ESLint
npm run build        # Production build
```
