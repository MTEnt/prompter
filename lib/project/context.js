/**
 * Project attach + query-aware context slices for Prompter.
 * All local. No network.
 */

import crypto from "node:crypto";
import { packDirectory } from "./pack.js";

/** @type {Map<string, object>} */
const projects = new Map();

/**
 * Attach a folder: walk + pack once, keep in memory for this Prompter process.
 * @param {string} rootPath
 * @param {{ structureOnly?: boolean }} [opts]
 */
export async function attachProject(rootPath, opts = {}) {
  const { pack, stats } = await packDirectory(rootPath, {
    source: rootPath,
    structureOnly: opts.structureOnly === true, // default full for better grounding
    style: "markdown",
    maxFileBytes: 200 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
  });

  const id = crypto.randomBytes(8).toString("hex");
  const record = {
    id,
    path: pack.root,
    name: pack.root.split(/[/\\]/).filter(Boolean).pop() || pack.root,
    tree: pack.tree,
    files: pack.files.map((f) => ({
      rel: f.rel,
      content: f.content,
      tokens: f.tokens,
      size: f.size,
    })),
    stats,
    attachedAt: Date.now(),
  };
  projects.set(id, record);
  // keep last 6 projects only
  if (projects.size > 6) {
    const oldest = [...projects.entries()].sort((a, b) => a[1].attachedAt - b[1].attachedAt)[0];
    if (oldest) projects.delete(oldest[0]);
  }
  return {
    id: record.id,
    path: record.path,
    name: record.name,
    fileCount: record.files.length,
    tokens: stats.tokens,
    bytesLabel: stats.bytesLabel,
    treePreview: record.tree.split("\n").slice(0, 40).join("\n"),
  };
}

export function getProject(id) {
  if (!id) return null;
  return projects.get(id) || null;
}

/**
 * Rank files against the user request; return a compact context block.
 * @param {object} project
 * @param {string} query
 * @param {{ maxFiles?: number, maxChars?: number }} [opts]
 */
export function buildContextForQuery(project, query, opts = {}) {
  if (!project) return { text: "", usedFiles: [] };
  const maxFiles = opts.maxFiles ?? 10;
  const maxChars = opts.maxChars ?? 28000;

  const terms = tokenize(query);
  const scored = project.files
    .map((f) => ({
      ...f,
      score: scoreFile(f, terms, query),
    }))
    .sort((a, b) => b.score - a.score);

  // Always prefer some "entry" files if scores are flat
  const boostNames = /^(readme|package\.json|app\.|server\.|index\.|main\.|src\/)/i;
  for (const f of scored) {
    if (boostNames.test(f.rel)) f.score += 2;
  }
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let chars = 0;
  for (const f of scored) {
    if (picked.length >= maxFiles) break;
    if (f.score <= 0 && picked.length >= 4) break;
    const body = truncate(f.content, 4500);
    if (chars + body.length > maxChars && picked.length >= 3) break;
    picked.push({ rel: f.rel, content: body, score: f.score });
    chars += body.length;
  }

  if (!picked.length && project.files[0]) {
    const f = project.files[0];
    picked.push({ rel: f.rel, content: truncate(f.content, 3000), score: 0 });
  }

  const treeLines = project.tree.split("\n").slice(0, 80).join("\n");
  const parts = [
    `## Attached project (local)`,
    `Path: ${project.path}`,
    `Name: ${project.name}`,
    ``,
    `### Directory tree (partial)`,
    "```",
    treeLines,
    "```",
    ``,
    `### Relevant files for this request`,
    `The user is working in this real codebase. Prefer these real paths. Do not invent files.`,
    ``,
  ];

  for (const f of picked) {
    parts.push(`#### ${f.rel}`);
    parts.push("```");
    parts.push(f.content.replace(/\n$/, ""));
    parts.push("```");
    parts.push("");
  }

  parts.push(
    `### How to use this context`,
    `- Ground the improved prompt in these files and the tree.`,
    `- Name real paths when asking the coding agent to change things.`,
    `- If something is missing from excerpts, tell the agent to open it from the project path above.`
  );

  return {
    text: parts.join("\n"),
    usedFiles: picked.map((p) => p.rel),
  };
}

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "want",
  "need",
  "make",
  "please",
  "just",
  "like",
  "some",
  "about",
  "when",
  "then",
  "than",
  "also",
  "using",
  "code",
  "file",
  "files",
  "project",
]);

function scoreFile(f, terms, rawQuery) {
  const pathL = f.rel.toLowerCase();
  const bodyL = (f.content || "").toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (pathL.includes(t)) score += 6;
    if (pathL.split(/[/_.-]/).includes(t)) score += 4;
    // content hits (capped)
    let idx = 0;
    let hits = 0;
    while (hits < 8) {
      const i = bodyL.indexOf(t, idx);
      if (i === -1) break;
      hits++;
      idx = i + t.length;
    }
    score += hits;
  }
  // path-ish tokens in query
  if (/\.[a-z]{1,4}\b/.test(rawQuery) && pathL.includes(rawQuery.toLowerCase().match(/\S+\.[a-z0-9]+/)?.[0] || "___")) {
    score += 12;
  }
  // prefer source over docs slightly when tied
  if (/\.(js|ts|tsx|jsx|py|go|rs)$/.test(pathL)) score += 0.5;
  return score;
}

function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n… [truncated]";
}
