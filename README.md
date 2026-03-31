# ⚡ Coded — CodeSpring-Style App Engine

A minimal but powerful app engine that scaffolds features into this repository via structured API calls.

## What it does

- **Agent Layer** (`/api/agent`) — reads, creates and updates files; applies templates
- **Workflow Layer** (`/api/workflow`) — decomposes high-level tasks into ordered agent steps
- **Deploy Layer** (`/api/deploy`) — triggers a Vercel deployment via a deploy hook
- **Template System** (`/templates`) — reusable code starters with placeholder substitution
- **Dashboard UI** (`/`) — interactive browser UI to run workflows and agent actions

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in VERCEL_DEPLOY_HOOK_URL if needed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run a workflow

```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "create_crud_feature",
    "params": { "model_name": "Case", "fields": "title,status,description" },
    "deploy": false
  }'
```

This scaffolds a schema file, API route, list page, and form for the `Case` model.

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/how-it-works.md](docs/how-it-works.md) | Architecture overview |
| [docs/adding-templates.md](docs/adding-templates.md) | How to add new templates |
| [docs/defining-workflows.md](docs/defining-workflows.md) | How to define new workflows |
| [docs/setup.md](docs/setup.md) | Local and production setup |

## Repository Structure

```
coded/
├── app/
│   ├── api/
│   │   ├── agent/route.ts       # Agent endpoint
│   │   ├── workflow/route.ts    # Workflow endpoint
│   │   └── deploy/route.ts     # Deploy endpoint
│   ├── layout.tsx
│   └── page.tsx                 # Dashboard UI
├── lib/
│   ├── types.ts                 # Shared TypeScript types
│   ├── templates.ts             # Template loader & substitution
│   ├── agent.ts                 # Agent logic
│   └── workflow.ts              # Workflow engine
├── templates/
│   ├── crud/                    # CRUD scaffold templates
│   ├── landing/                 # Landing page template
│   ├── dashboard/               # Dashboard section template
│   ├── auth/                    # Auth page template
│   ├── api/                     # API route template
│   └── metadata.json            # Template catalog
├── docs/                        # Documentation
├── .env.example
├── next.config.js
├── package.json
└── tsconfig.json
```