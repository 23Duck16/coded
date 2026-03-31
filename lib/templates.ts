import fs from "fs";
import path from "path";
import type { TemplateCatalog, TemplateMetadata } from "./types";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

/**
 * Load the template catalog (metadata.json).
 */
export function loadCatalog(): TemplateCatalog {
  const catalogPath = path.join(TEMPLATES_DIR, "metadata.json");
  if (!fs.existsSync(catalogPath)) {
    return { version: "1.0.0", templates: [] };
  }
  const raw = fs.readFileSync(catalogPath, "utf-8");
  return JSON.parse(raw) as TemplateCatalog;
}

/**
 * Find a template's metadata by name.
 */
export function findTemplate(name: string): TemplateMetadata | undefined {
  const catalog = loadCatalog();
  return catalog.templates.find((t) => t.name === name);
}

/**
 * Load a template file's raw content.
 * @param templateName - The template name (maps to a subfolder in /templates)
 * @param fileName - The specific file inside that subfolder
 */
export function loadTemplateFile(
  templateName: string,
  fileName: string
): string {
  const filePath = path.join(TEMPLATES_DIR, templateName, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Template file not found: templates/${templateName}/${fileName}`
    );
  }
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Substitute all {{PLACEHOLDER}} occurrences in a template string.
 *
 * Placeholders are case-insensitive and match the pattern `{{KEY}}`.
 * Keys are uppercased before matching, so `modelName` matches `{{MODEL_NAME}}`.
 */
export function substitutePlaceholders(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    // Try exact match first, then camelCase → UPPER_SNAKE_CASE conversion
    const value =
      params[key] ??
      params[camelToUpperSnake(key)] ??
      params[upperSnakeToCamel(key)];
    return value !== undefined ? value : match;
  });
}

/**
 * Load a template, substitute placeholders, and return the rendered content.
 */
export function renderTemplate(
  templateName: string,
  fileName: string,
  params: Record<string, string>
): string {
  const raw = loadTemplateFile(templateName, fileName);
  return substitutePlaceholders(raw, params);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function camelToUpperSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toUpperCase()
    .replace(/^_/, "");
}

function upperSnakeToCamel(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
