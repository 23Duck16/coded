# Adding New Templates

Templates are reusable code starters that the Agent layer can apply to any target path.

---

## 1. Create the Template Directory

```
templates/
└── my-template/
    ├── template.ts    ← used when target_path ends in .ts
    ├── template.tsx   ← used when target_path ends in .tsx
    └── template.md    ← used when target_path ends in .md
```

## 2. Add Placeholders

Use `{{UPPER_SNAKE_CASE}}` placeholders in your template files:

```tsx
// templates/my-template/template.tsx
export default function {{COMPONENT_NAME}}() {
  return <div>{{DESCRIPTION}}</div>;
}
```

Placeholders are resolved from the `params` object in the agent request.  
Both `COMPONENT_NAME` and `componentName` in `params` will resolve `{{COMPONENT_NAME}}`.

## 3. Register in metadata.json

Add an entry to `templates/metadata.json`:

```json
{
  "name": "my-template",
  "description": "Short description of this template",
  "category": "ui",
  "path": "my-template",
  "params": [
    {
      "name": "COMPONENT_NAME",
      "description": "PascalCase component name",
      "required": true
    },
    {
      "name": "DESCRIPTION",
      "description": "Component description",
      "required": false,
      "default": "My Component"
    }
  ],
  "files": ["template.tsx"]
}
```

## 4. Use the Template

Via the Agent API:

```json
{
  "action": "apply_template",
  "target_path": "app/components/MyWidget.tsx",
  "template_name": "my-template",
  "params": {
    "COMPONENT_NAME": "MyWidget",
    "DESCRIPTION": "A reusable widget"
  },
  "description": "Scaffold MyWidget component"
}
```

Or as a step inside a workflow (see `lib/workflow.ts`).

---

## Template File Selection

The agent picks the template file based on the file extension of `target_path`:

| Target extension | Template file loaded |
|-----------------|---------------------|
| `.ts`           | `template.ts`       |
| `.tsx`          | `template.tsx`      |
| `.md`           | `template.md`       |
| `.json`         | `template.json`     |
| *(any)*         | `template.<ext>`    |

If the file is missing, the agent returns an error with the expected path.
