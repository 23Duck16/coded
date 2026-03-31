"use client";

// Auto-generated list page for {{MODEL_NAME}}
import { useEffect, useState } from "react";
import Link from "next/link";

interface {{MODEL_NAME}} {
  id: string;
  [key: string]: unknown;
}

export default function {{MODEL_NAME}}ListPage() {
  const [items, setItems] = useState<{{MODEL_NAME}}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/{{MODEL_SLUG}}")
      .then((res) => res.json())
      .then((data: {{MODEL_NAME}}[]) => setItems(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8">Loading {{MODEL_NAME}}s…</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{{MODEL_NAME}}s</h1>
        <Link
          href="/{{MODEL_SLUG}}/new"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + New {{MODEL_NAME}}
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-gray-500">No {{MODEL_NAME}}s found. Create one to get started.</p>
      ) : (
        <table className="w-full border-collapse border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="border border-gray-200 px-4 py-2 text-left">ID</th>
              <th className="border border-gray-200 px-4 py-2 text-left">Created</th>
              <th className="border border-gray-200 px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                  {item.id}
                </td>
                <td className="border border-gray-200 px-4 py-2 text-sm">
                  {String(item.createdAt)}
                </td>
                <td className="border border-gray-200 px-4 py-2">
                  <Link
                    href={`/{{MODEL_SLUG}}/${item.id}`}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
