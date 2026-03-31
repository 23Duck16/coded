"use client";

// Auto-generated create/edit form for {{MODEL_NAME}}
import { useState } from "react";
import { useRouter } from "next/navigation";

interface FormData {
  [key: string]: string;
}

const FIELDS = "{{FIELDS}}".split(",").map((f) => f.trim()).filter(Boolean);

export default function {{MODEL_NAME}}Form({ id }: { id?: string }) {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>(
    Object.fromEntries(FIELDS.map((f) => [f, ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const method = id ? "PUT" : "POST";
    const url = id ? `/api/{{MODEL_SLUG}}/${id}` : "/api/{{MODEL_SLUG}}";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      router.push("/{{MODEL_SLUG}}");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        {id ? "Edit" : "New"} {{MODEL_NAME}}
      </h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {FIELDS.map((field) => (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
              {field}
            </label>
            <input
              type="text"
              value={formData[field] ?? ""}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, [field]: e.target.value }))
              }
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={`Enter ${field}`}
            />
          </div>
        ))}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="border border-gray-300 px-6 py-2 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
