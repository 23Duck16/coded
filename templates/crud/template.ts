// Auto-generated model type for {{MODEL_NAME}}
// Fields: {{FIELDS}}

export interface {{MODEL_NAME}} {
  id: string;
  {{FIELDS_TYPED}}
  createdAt: Date;
  updatedAt: Date;
}

export type Create{{MODEL_NAME}}Input = Omit<{{MODEL_NAME}}, "id" | "createdAt" | "updatedAt">;
export type Update{{MODEL_NAME}}Input = Partial<Create{{MODEL_NAME}}Input>;

// In-memory store (replace with your database of choice)
const store: Map<string, {{MODEL_NAME}}> = new Map();

export function getAll{{MODEL_NAME}}s(): {{MODEL_NAME}}[] {
  return Array.from(store.values());
}

export function get{{MODEL_NAME}}ById(id: string): {{MODEL_NAME}} | undefined {
  return store.get(id);
}

export function create{{MODEL_NAME}}(input: Create{{MODEL_NAME}}Input): {{MODEL_NAME}} {
  const now = new Date();
  const item: {{MODEL_NAME}} = {
    id: crypto.randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  store.set(item.id, item);
  return item;
}

export function update{{MODEL_NAME}}(id: string, input: Update{{MODEL_NAME}}Input): {{MODEL_NAME}} | null {
  const existing = store.get(id);
  if (!existing) return null;
  const updated: {{MODEL_NAME}} = { ...existing, ...input, updatedAt: new Date() };
  store.set(id, updated);
  return updated;
}

export function delete{{MODEL_NAME}}(id: string): boolean {
  return store.delete(id);
}
