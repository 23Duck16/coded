// Auto-generated API route for {{MODEL_NAME}}
// Fields: {{FIELDS}}
import { NextRequest, NextResponse } from "next/server";

interface {{MODEL_NAME}} {
  id: string;
  [key: string]: unknown;
  createdAt: string;
  updatedAt: string;
}

// In-memory store — swap for your DB adapter
const store = new Map<string, {{MODEL_NAME}}>();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(Array.from(store.values()));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const item: {{MODEL_NAME}} = {
      id: crypto.randomUUID(),
      ...body,
      createdAt: now,
      updatedAt: now,
    };
    store.set(item.id, item);
    return NextResponse.json(item, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
