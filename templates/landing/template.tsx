// Auto-generated landing page at /{{PAGE_PATH}}
export default function {{PAGE_TITLE}}Page() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-screen text-center px-4">
        <h1 className="text-5xl font-extrabold tracking-tight mb-4">
          {{PAGE_TITLE}}
        </h1>
        <p className="text-xl text-slate-300 max-w-2xl mb-8">
          {{ENTITY_DESCRIPTION}}
        </p>
        <a
          href="#get-started"
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-8 py-3 rounded-full transition"
        >
          Get Started
        </a>
      </section>

      {/* Features placeholder */}
      <section id="get-started" className="py-24 bg-white text-gray-900">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          {["Feature One", "Feature Two", "Feature Three"].map((f) => (
            <div key={f} className="p-6 border border-gray-200 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-2">{f}</h3>
              <p className="text-gray-500 text-sm">
                Describe this feature here. Edit the template to customize.
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
