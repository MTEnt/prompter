/**
 * Project attach + query-aware context slices for Prompter.
 * All local. No network.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { packDirectory } from "./pack.js";
import { isForbiddenAttachRoot } from "./security-path.js";
import { estimateTokens } from "./tokens.js";

/** @type {Map<string, object>} */
const projects = new Map();

/** One-time attach tickets from native folder picker */
/** @type {Map<string, { path: string, exp: number }>} */
const attachTickets = new Map();

const TICKET_TTL_MS = 5 * 60 * 1000;

/**
 * @param {string} folderPath
 */
export function issueAttachTicket(folderPath) {
  const token = crypto.randomBytes(16).toString("hex");
  attachTickets.set(token, { path: folderPath, exp: Date.now() + TICKET_TTL_MS });
  // prune
  for (const [k, v] of attachTickets) {
    if (v.exp < Date.now()) attachTickets.delete(k);
  }
  return token;
}

/**
 * Validate attach ticket. Pass consume:true only after successful pack.
 * @param {string} token
 * @param {string} claimedPath
 * @param {{ peek?: boolean, consume?: boolean }} [opts]
 */
export function consumeAttachTicket(token, claimedPath, opts = {}) {
  if (!token) return { ok: false, error: "Missing attach ticket. Use Choose folder again." };
  const t = attachTickets.get(token);
  if (!t) return { ok: false, error: "Attach ticket expired. Choose the folder again." };
  if (t.exp < Date.now()) {
    attachTickets.delete(token);
    return { ok: false, error: "Attach ticket expired. Choose the folder again." };
  }
  const a = path.resolve(t.path);
  const b = path.resolve(claimedPath);
  if (a !== b) return { ok: false, error: "Folder does not match the picker selection." };
  if (opts.consume) attachTickets.delete(token);
  return { ok: true, path: a };
}

/**
 * Attach a folder: walk + pack once, keep in memory for this Prompter process.
 * @param {string} rootPath
 * @param {{ structureOnly?: boolean }} [opts]
 */
export async function attachProject(rootPath, opts = {}) {
  let resolved = path.resolve(rootPath);
  try {
    resolved = await fs.realpath(resolved);
  } catch {
    throw new Error("That folder does not exist on this computer.");
  }
  const st = await fs.stat(resolved);
  if (!st.isDirectory()) throw new Error("That path is not a folder.");
  if (isForbiddenAttachRoot(resolved)) {
    throw new Error("That folder is blocked for safety (system or credential directory).");
  }

  const { pack, stats } = await packDirectory(resolved, {
    source: resolved,
    structureOnly: opts.structureOnly === true,
    style: "markdown",
    maxFileBytes: 160 * 1024,
    maxTotalBytes: 6 * 1024 * 1024,
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
    skippedCount: pack.skippedFiles?.length || 0,
    attachedAt: Date.now(),
  };
  projects.set(id, record);
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
    skippedCount: record.skippedCount,
    treePreview: record.tree.split("\n").slice(0, 40).join("\n"),
  };
}

export function getProject(id) {
  if (!id) return null;
  return projects.get(id) || null;
}

export function requireProject(id) {
  if (!id) {
    return { ok: false, code: "PROJECT_REQUIRED", error: "Attach a project folder first." };
  }
  const p = projects.get(id);
  if (!p) {
    return {
      ok: false,
      code: "PROJECT_GONE",
      error: "Project session expired. Choose the project folder again.",
    };
  }
  return { ok: true, project: p };
}

export function detachProject(id) {
  if (id) projects.delete(id);
  return { ok: true };
}

/**
 * Re-pack an existing project under the same id (no session churn).
 * @param {string} id
 */
export async function reindexProject(id) {
  const need = requireProject(id);
  if (!need.ok) return need;
  const prev = need.project;
  const { pack, stats } = await packDirectory(prev.path, {
    source: prev.path,
    structureOnly: false,
    style: "markdown",
    maxFileBytes: 160 * 1024,
    maxTotalBytes: 6 * 1024 * 1024,
  });
  const record = {
    id: prev.id,
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
    skippedCount: pack.skippedFiles?.length || 0,
    attachedAt: Date.now(),
  };
  projects.set(prev.id, record);
  return {
    ok: true,
    project: {
      id: record.id,
      path: record.path,
      name: record.name,
      fileCount: record.files.length,
      tokens: stats.tokens,
      bytesLabel: stats.bytesLabel,
      skippedCount: record.skippedCount,
      treePreview: record.tree.split("\n").slice(0, 40).join("\n"),
    },
  };
}

/**
 * Rank files against the user request; return a compact context block.
 * @param {object} project
 * @param {string} query
 * @param {{ maxFiles?: number, maxChars?: number }} [opts]
 */
export function buildContextForQuery(project, query, opts = {}) {
  if (!project) {
    return { text: "", usedFiles: [], evidence: [], promptTokens: 0, empty: true };
  }
  const maxFiles = opts.maxFiles ?? 8;
  const maxChars = opts.maxChars ?? 18000;
  const maxExcerpt = opts.maxExcerpt ?? 2200;

  const terms = tokenize(query);
  const scored = project.files
    .map((f) => {
      const { score, reasons } = scoreFile(f, terms, query);
      return { ...f, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  for (const f of scored) {
    if (/^(readme\.md|package\.json|app\.(js|ts|tsx)|server\.(js|ts)|index\.(js|ts|tsx)|main\.(js|ts|py|go)|src\/)/i.test(f.rel)) {
      f.score += 1.5;
      f.reasons.push("entry-ish path");
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let chars = 0;
  for (const f of scored) {
    if (picked.length >= maxFiles) break;
    if (f.score <= 0 && picked.length >= 3) break;
    const body = truncate(f.content, maxExcerpt);
    if (chars + body.length > maxChars && picked.length >= 2) break;
    picked.push({
      rel: f.rel,
      content: body,
      score: f.score,
      reasons: f.reasons.slice(0, 4),
    });
    chars += body.length;
  }

  // Always try to include package.json / README if present and not already picked
  for (const must of ["package.json", "README.md", "readme.md"]) {
    if (picked.some((p) => p.rel === must || p.rel.endsWith("/" + must))) continue;
    const hit = project.files.find((f) => f.rel === must || f.rel.endsWith("/" + must));
    if (hit && picked.length < maxFiles + 2) {
      picked.unshift({
        rel: hit.rel,
        content: truncate(hit.content, 1500),
        score: hit.score || 0,
        reasons: ["always include project metadata"],
      });
    }
  }

  const empty = picked.length === 0;
  if (empty && project.files[0]) {
    const f = project.files[0];
    picked.push({
      rel: f.rel,
      content: truncate(f.content, 1500),
      score: 0,
      reasons: ["fallback: highest pack order"],
    });
  }

  const treeLines = project.tree.split("\n").slice(0, 60).join("\n");
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
    `### Relevant files (ranked for this request)`,
    `Open these paths in the project. Prefer them over inventing files.`,
    ``,
  ];

  for (const f of picked) {
    parts.push(`#### ${f.rel}`);
    if (f.reasons?.length) parts.push(`Why: ${f.reasons.join("; ")}`);
    parts.push("```");
    parts.push(f.content.replace(/\n$/, ""));
    parts.push("```");
    parts.push("");
  }

  parts.push(
    `### Instructions for using context`,
    `- Working directory: ${project.path}`,
    `- Cite real paths from the list above.`,
    `- If a needed file is missing, open it from the project path (do not invent).`
  );

  const text = parts.join("\n");
  return {
    text,
    usedFiles: picked.map((p) => p.rel),
    evidence: picked.map((p) => ({
      path: p.rel,
      score: Math.round(p.score * 10) / 10,
      reasons: p.reasons || [],
    })),
    promptTokens: estimateTokens(text),
    empty: false,
  };
}

function tokenize(q) {
  const raw = String(q || "").toLowerCase();
  const parts = raw.split(/[^a-z0-9_./-]+/).filter((t) => t.length > 2 && !STOP.has(t));
  // camelCase split
  const extra = [];
  for (const t of parts) {
    const bits = t.split(/(?<=[a-z])(?=[A-Z])/).map((x) => x.toLowerCase());
    extra.push(...bits.filter((b) => b.length > 2));
  }
  return [...new Set([...parts, ...extra])];
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "have",
  "want", "need", "make", "please", "just", "like", "some", "about", "when",
  "then", "than", "also", "using", "code", "file", "files", "project", "should",
  "could", "would", "there", "their", "what", "where", "which",
]);

function scoreFile(f, terms, rawQuery) {
  const pathL = f.rel.toLowerCase();
  const base = pathL.split("/").pop() || pathL;
  const bodyL = (f.content || "").slice(0, 12000).toLowerCase();
  let score = 0;
  const reasons = [];

  for (const t of terms) {
    if (base === t || base.startsWith(t + ".") || base.includes(t)) {
      score += 10;
      reasons.push(`name~${t}`);
    } else if (pathL.split(/[/_.-]/).includes(t)) {
      score += 7;
      reasons.push(`path~${t}`);
    } else if (pathL.includes(t)) {
      score += 3;
    }
    let idx = 0;
    let hits = 0;
    while (hits < 6) {
      const i = bodyL.indexOf(t, idx);
      if (i === -1) break;
      hits++;
      idx = i + t.length;
    }
    if (hits) {
      score += hits * 0.8;
      if (hits >= 2) reasons.push(`body×${hits}:${t}`);
    }
  }

  const pathInQuery = rawQuery.match(/[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|md|css|html|json)\b/i);
  if (pathInQuery && pathL.includes(pathInQuery[0].toLowerCase())) {
    score += 20;
    reasons.push("exact path in request");
  }

  if (/\.(js|ts|tsx|jsx|py|go|rs)$/.test(pathL)) score += 0.3;
  if (/\.(md|txt)$/.test(pathL) && !/readme/i.test(pathL)) score -= 0.5;

  return { score, reasons: [...new Set(reasons)] };
}

function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n… [truncated]";
}
