import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateFile } from "./frontmatter.js";
import { PROFILES } from "./profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_ROOT = path.join(__dirname, "..", "library");

/**
 * Load all templates from library/templates/**\/*.md
 */
export function loadTemplates(root = LIBRARY_ROOT) {
  const base = path.join(root, "templates");
  if (!fs.existsSync(base)) return [];
  const files = walk(base).filter((f) => f.endsWith(".md"));
  const templates = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const { meta, body } = parseTemplateFile(raw);
      if (!meta.id) meta.id = path.basename(file, ".md");
      const rel = path.relative(base, file);
      const category = rel.split(path.sep)[0] || "general";
      templates.push(normalizeTemplate({ ...meta, body, file, category }));
    } catch (err) {
      console.warn(`Skip template ${file}:`, err.message);
    }
  }
  return templates.sort((a, b) => a.title.localeCompare(b.title));
}

export function loadPatterns(root = LIBRARY_ROOT) {
  const base = path.join(root, "patterns");
  if (!fs.existsSync(base)) return [];
  return walk(base)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(file, "utf8");
      const { meta, body } = parseTemplateFile(raw);
      return {
        id: meta.id || path.basename(file, ".md"),
        title: meta.title || path.basename(file, ".md"),
        summary: meta.summary || "",
        tags: asArray(meta.tags),
        body,
        file,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function normalizeTemplate(t) {
  return {
    id: String(t.id),
    title: t.title || t.id,
    description: t.description || "",
    category: t.category || "general",
    tags: asArray(t.tags),
    targets: asArray(t.targets).length ? asArray(t.targets) : ["generic"],
    variables: normalizeVars(t.variables),
    defaultTask: t.defaultTask || t.task || "general",
    defaultStrength: t.defaultStrength || t.strength || "medium",
    body: t.body || "",
    source: t.source || "",
    file: t.file,
  };
}

function normalizeVars(vars) {
  if (!vars) return [];
  if (!Array.isArray(vars)) return [];
  return vars.map((v) => {
    if (typeof v === "string") return { name: v, required: false, label: v };
    return {
      name: v.name,
      label: v.label || v.name,
      required: Boolean(v.required),
      default: v.default ?? "",
      help: v.help || "",
    };
  });
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function getTemplate(id, templates) {
  const list = templates || loadTemplates();
  return list.find((t) => t.id === id) || null;
}

export function searchTemplates(query, opts = {}) {
  const list = opts.templates || loadTemplates();
  const q = (query || "").toLowerCase().trim();
  const tag = (opts.tag || "").toLowerCase();
  const category = (opts.category || "").toLowerCase();
  const target = (opts.target || "").toLowerCase();

  return list.filter((t) => {
    if (tag && !t.tags.map((x) => x.toLowerCase()).includes(tag)) return false;
    if (category && t.category.toLowerCase() !== category) return false;
    if (target && !t.targets.map((x) => x.toLowerCase()).includes(target) && !t.targets.includes("generic")) {
      // allow templates that list this target OR include all
      if (!t.targets.includes("all")) return false;
    }
    if (!q) return true;
    const hay = [t.id, t.title, t.description, t.category, ...t.tags].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** Replace {{var}} and {{var|default}} placeholders */
export function renderTemplate(template, variables = {}) {
  const missing = [];
  for (const v of template.variables || []) {
    if (v.required && (variables[v.name] == null || String(variables[v.name]).trim() === "")) {
      if (v.default == null || v.default === "") missing.push(v.name);
    }
  }
  if (missing.length) {
    return { ok: false, error: `Missing required variables: ${missing.join(", ")}`, missing };
  }

  const vars = { ...Object.fromEntries((template.variables || []).map((v) => [v.name, v.default ?? ""])), ...variables };

  let body = template.body;
  body = body.replace(/\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g, (_, name, def) => {
    const val = vars[name];
    if (val != null && String(val).trim() !== "") return String(val);
    if (def != null) return def.trim();
    return "";
  });

  // Clean empty leftover lines from unused optional blocks
  body = body.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return { ok: true, text: body, variables: vars };
}

/**
 * Wrap rendered prompt for a specific AI tool / product surface.
 */
export function exportForTool(text, tool, meta = {}) {
  const t = (tool || "generic").toLowerCase();
  const title = meta.title || "Prompt";
  const profile = PROFILES[t] || PROFILES.generic;

  const wrappers = {
    codex: {
      format: "markdown",
      hint: "Paste into Codex chat, or save as a prompt. Prefix with $skill if using project skills.",
      text: `${text}\n\n---\n<!-- Prompter → Codex | ${title} -->\n`,
    },
    claude: {
      format: "markdown",
      hint: "Paste into Claude / Claude Code. Works with CLAUDE.md + skills.",
      text: `${text}\n\n---\n<!-- Prompter → Claude | ${title} -->\n`,
    },
    grok: {
      format: "markdown",
      hint: "Paste into Grok or Grok Build.",
      text: `${text}\n\n---\n<!-- Prompter → Grok | ${title} -->\n`,
    },
    gemini: {
      format: "markdown",
      hint: "Paste into Gemini or Gemini CLI.",
      text: `${text}\n\n---\n<!-- Prompter → Gemini | ${title} -->\n`,
    },
    cursor: {
      format: "markdown",
      hint: "Use in Cursor chat/agent. Can also drop into .cursor/rules for standing instructions.",
      text: `${text}\n`,
    },
    copilot: {
      format: "markdown",
      hint: "Use as a Copilot Chat prompt or save under .github/prompts/ as a prompt file.",
      text: `${text}\n`,
    },
    agents_md: {
      format: "markdown",
      hint: "Fragment suitable to merge into AGENTS.md (project standing instructions).",
      text: `## ${title} (from Prompter)\n\n${text}\n`,
    },
    skill: {
      format: "markdown",
      hint: "Agent Skills SKILL.md skeleton: fill name/description and install under .agents/skills/<id>/",
      text: `---
name: ${(meta.id || "prompter-skill").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}
description: ${meta.description || title}. Use when the user asks for this workflow.
---

# ${title}

${text}
`,
    },
    system: {
      format: "text",
      hint: "Use as a system / developer message when the product supports it.",
      text: `${profile.preamble}\n\n${text}\n`,
    },
    clipboard: {
      format: "text",
      hint: "Plain text for clipboard.",
      text: `${text}\n`,
    },
    generic: {
      format: "markdown",
      hint: "Generic multi-model prompt.",
      text: `${text}\n`,
    },
  };

  return wrappers[t] || wrappers.generic;
}

export function listCategories(templates) {
  const list = templates || loadTemplates();
  const map = new Map();
  for (const t of list) {
    map.set(t.category, (map.get(t.category) || 0) + 1);
  }
  return [...map.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
}

export function libraryIndex() {
  const templates = loadTemplates();
  const patterns = loadPatterns();
  return {
    templates: templates.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      tags: t.tags,
      targets: t.targets,
      variables: t.variables,
      defaultTask: t.defaultTask,
      defaultStrength: t.defaultStrength,
      source: t.source,
    })),
    patterns: patterns.map((p) => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      tags: p.tags,
    })),
    categories: listCategories(templates),
    count: { templates: templates.length, patterns: patterns.length },
  };
}
