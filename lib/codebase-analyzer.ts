import fs from "fs";
import path from "path";
import type { TemplateMetadata } from "./types";

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface ModelInfo {
  name: string;
  fields: string[];
  path: string;
}

export interface RouteInfo {
  path: string;
  methods: string[];
  model?: string;
}

export interface ComponentInfo {
  name: string;
  path: string;
  exports: string[];
}

export interface TemplateInfo {
  id: string;
  category: string;
  params: string[];
}

export interface RepositoryStructure {
  models: ModelInfo[];
  routes: RouteInfo[];
  components: ComponentInfo[];
  templates: TemplateInfo[];
  conflicts?: string[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: RepositoryStructure;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a path relative to the repo root (process.cwd()). */
function repoPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

/** Return all files matching a simple glob-style extension filter under a dir. */
function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Model Parsing ────────────────────────────────────────────────────────────

/**
 * Parse `lib/models/*.ts` files to extract model names and field names.
 *
 * Looks for:
 *   export interface <Name> { … }
 *   field: type;
 */
function parseModels(): ModelInfo[] {
  const modelsDir = repoPath("lib", "models");
  const files = walkFiles(modelsDir, ".ts");
  const models: ModelInfo[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");

    // Extract all exported interface / type names from the file
    const interfaceMatches = [
      ...source.matchAll(
        /export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)/g
      ),
    ];
    if (interfaceMatches.length === 0) continue;

    // Field names: lines with "fieldName?: type;" regardless of indentation
    const fieldMatches = [...source.matchAll(/^[ \t]+(\w+)\s*[?:]?\s*:/gm)];
    const fields = fieldMatches.map((m) => m[1]);

    // Use the first exported name as the canonical model name
    const modelName = interfaceMatches[0][1];

    models.push({
      name: modelName,
      fields,
      path: path.relative(process.cwd(), file),
    });
  }

  return models;
}

// ─── Route Parsing ────────────────────────────────────────────────────────────

/** HTTP methods exported from a Next.js App Router route file. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/**
 * Scan `app/api` for route.ts files and extract exported HTTP methods.
 */
function parseRoutes(): RouteInfo[] {
  const apiDir = repoPath("app", "api");
  const files = walkFiles(apiDir, ".ts").filter((f) =>
    f.endsWith("route.ts")
  );
  const routes: RouteInfo[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");
    const methods = HTTP_METHODS.filter((m) =>
      new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(source)
    );

    // Derive the URL path from the file system path
    const rel = path.relative(repoPath("app"), file);
    // e.g. "api/agent/route.ts" → "/api/agent"
    const routePath =
      "/" + rel.replace(/\/route\.tsx?$/, "").replace(/\\/g, "/");

    // Guess associated model from directory name (capitalize first letter)
    const segments = routePath.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    const model =
      lastSegment && lastSegment !== "api"
        ? lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1)
        : undefined;

    routes.push({ path: routePath, methods, model });
  }

  return routes;
}

// ─── Component Parsing ────────────────────────────────────────────────────────

/**
 * Scan `app/**\/*.tsx` to catalog React components.
 * Extracts `export default function <Name>` and `export function <Name>`.
 */
function parseComponents(): ComponentInfo[] {
  const appDir = repoPath("app");
  const files = walkFiles(appDir, ".tsx");
  const components: ComponentInfo[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");

    const exportMatches = [
      ...source.matchAll(
        /export\s+(?:default\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g
      ),
    ];
    const exports = exportMatches.map((m) => m[1]);

    // Component name: first export or derived from file name
    const name =
      exports[0] ??
      path
        .basename(file, path.extname(file))
        .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());

    components.push({
      name,
      path: path.relative(process.cwd(), file),
      exports,
    });
  }

  return components;
}

// ─── Template Parsing ─────────────────────────────────────────────────────────

/**
 * Load template metadata from `templates/metadata.json` and enrich with
 * param names extracted from each template's params array.
 */
function parseTemplates(): TemplateInfo[] {
  const metadataFile = repoPath("templates", "metadata.json");
  if (!fs.existsSync(metadataFile)) return [];

  const raw = fs.readFileSync(metadataFile, "utf-8");
  const catalog = JSON.parse(raw) as {
    templates?: TemplateMetadata[];
  };

  return (catalog.templates ?? []).map((t) => ({
    id: t.path,
    category: t.category,
    params: t.params.map((p) => p.name),
  }));
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

function detectConflicts(models: ModelInfo[], routes: RouteInfo[]): string[] {
  const conflicts: string[] = [];

  // Duplicate model names
  const modelNames = models.map((m) => m.name);
  const duplicateModels = modelNames.filter(
    (name, idx) => modelNames.indexOf(name) !== idx
  );
  for (const dup of duplicateModels) {
    conflicts.push(`Duplicate model name: ${dup}`);
  }

  // Duplicate route paths
  const routePaths = routes.map((r) => r.path);
  const duplicateRoutes = routePaths.filter(
    (p, idx) => routePaths.indexOf(p) !== idx
  );
  for (const dup of duplicateRoutes) {
    conflicts.push(`Duplicate route path: ${dup}`);
  }

  return conflicts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan the repository and return a structured summary of its contents.
 * Results are cached in memory for 5 minutes.
 */
export async function analyzeRepo(): Promise<RepositoryStructure> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.result;
  }

  const models = parseModels();
  const routes = parseRoutes();
  const components = parseComponents();
  const templates = parseTemplates();
  const conflicts = detectConflicts(models, routes);

  const result: RepositoryStructure = {
    models,
    routes,
    components,
    templates,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };

  cache = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}

/** Invalidate the in-memory cache (useful after files are written). */
export function invalidateAnalyzerCache(): void {
  cache = null;
}
