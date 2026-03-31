// Auto-generated dashboard section: {{SECTION_NAME}}
export default function {{SECTION_NAME}}Page() {
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{{SECTION_NAME}}</h1>
      <p className="text-gray-500 mb-8">{{ENTITY_DESCRIPTION}}</p>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {["Total", "Active", "Pending"].map((label) => (
          <div
            key={label}
            className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
          >
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-3xl font-bold mt-1">—</p>
          </div>
        ))}
      </div>

      {/* Data table placeholder */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold">{{SECTION_NAME}} Data</h2>
        </div>
        <div className="p-6 text-gray-400 text-sm">
          Connect your data source and replace this placeholder with a table or chart.
        </div>
      </div>
    </main>
  );
}
