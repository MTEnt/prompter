/**
 * Project attach + query-aware context slices for Prompter.
 * All local. No network.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { packDirectory } from "./pack.js";
import { isForbiddenAttachRoot } from "./security-path.js";
import {
  indexFiles,
  isTreeSitterAvailable,
  rankSymbols,
  symbolBody,
} from "./symbols.js";
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

  const record = await buildProjectRecord(resolved, null, opts);
  projects.set(record.id, record);
  if (projects.size > 6) {
    const oldest = [...projects.entries()].sort((a, b) => a[1].attachedAt - b[1].attachedAt)[0];
    if (oldest) projects.delete(oldest[0]);
  }
  return projectMeta(record);
}

/**
 * @param {string} rootPath
 * @param {string|null} keepId
 * @param {{ structureOnly?: boolean }} [opts]
 */
async function buildProjectRecord(rootPath, keepId, opts = {}) {
  const { pack, stats } = await packDirectory(rootPath, {
    source: rootPath,
    structureOnly: opts.structureOnly === true,
    style: "markdown",
    maxFileBytes: 160 * 1024,
    maxTotalBytes: 6 * 1024 * 1024,
  });

  const files = pack.files.map((f) => ({
    rel: f.rel,
    content: f.content,
    tokens: f.tokens,
    size: f.size,
  }));

  let symbolIndex = { files: [], symbolCount: 0, parsedFiles: 0, engineOk: 0 };
  if (isTreeSitterAvailable()) {
    try {
      symbolIndex = await indexFiles(files);
    } catch {
      symbolIndex = { files: [], symbolCount: 0, parsedFiles: 0, engineOk: 0, error: true };
    }
  }

  return {
    id: keepId || crypto.randomBytes(8).toString("hex"),
    path: pack.root,
    name: pack.root.split(/[/\\]/).filter(Boolean).pop() || pack.root,
    tree: pack.tree,
    files,
    stats,
    skippedCount: pack.skippedFiles?.length || 0,
    symbolIndex,
    attachedAt: Date.now(),
  };
}

function projectMeta(record) {
  return {
    id: record.id,
    path: record.path,
    name: record.name,
    fileCount: record.files.length,
    tokens: record.stats.tokens,
    bytesLabel: record.stats.bytesLabel,
    skippedCount: record.skippedCount,
    symbolCount: record.symbolIndex?.symbolCount || 0,
    parsedFiles: record.symbolIndex?.parsedFiles || 0,
    symbolEngine: isTreeSitterAvailable() ? "tree-sitter" : "none",
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
  const record = await buildProjectRecord(prev.path, prev.id, {});
  projects.set(prev.id, record);
  return { ok: true, project: projectMeta(record) };
}

/**
 * Rank symbols + files against the user request; return a compact context block.
 * Prefer tree-sitter symbols (signatures + bodies) over whole-file dumps.
 * @param {object} project
 * @param {string} query
 * @param {{ maxFiles?: number, maxChars?: number }} [opts]
 */
export function buildContextForQuery(project, query, opts = {}) {
  if (!project) {
    return {
      text: "",
      usedFiles: [],
      evidence: [],
      promptTokens: 0,
      empty: true,
      mode: "none",
    };
  }

  const maxChars = opts.maxChars ?? 16000;
  const contentByRel = new Map(project.files.map((f) => [f.rel, f.content]));
  const terms = tokenize(query);

  // --- Symbol-first path (tree-sitter index) ---
  const rankedSyms = project.symbolIndex?.symbolCount
    ? rankSymbols(project.symbolIndex, query, { max: 14 })
    : [];

  const treeLines = project.tree.split("\n").slice(0, 50).join("\n");
  const parts = [
    `## Attached project (local, symbol-aware)`,
    `Path: ${project.path}`,
    `Name: ${project.name}`,
    `Symbol engine: ${project.symbolIndex?.symbolCount ? "tree-sitter" : "file-text fallback"}`,
    `Symbols indexed: ${project.symbolIndex?.symbolCount || 0} across ${project.symbolIndex?.parsedFiles || 0} files`,
    ``,
    `### Directory tree (partial)`,
    "```",
    treeLines,
    "```",
    ``,
  ];

  /** @type {{ path: string, score: number, reasons: string[], kind?: string }[]} */
  const evidence = [];
  const usedFiles = new Set();
  let chars = 0;
  let mode = "file-fallback";

  if (rankedSyms.length) {
    mode = "tree-sitter-symbols";
    parts.push(`### Matched symbols (from syntax tree)`);
    parts.push(`These are real definitions parsed from the codebase. Prefer them over inventing APIs.`);
    parts.push(``);

    // Outline of matches
    for (const hit of rankedSyms.slice(0, 12)) {
      const s = hit.symbol;
      parts.push(
        `- \`${hit.file}\` · **${s.kind} ${s.name}** · L${s.startLine} · \`${s.signature.replace(/`/g, "'")}\``
      );
      evidence.push({
        path: `${hit.file} :: ${s.kind} ${s.name}`,
        score: hit.score,
        reasons: hit.reasons,
        kind: "symbol",
      });
      usedFiles.add(hit.file);
    }
    parts.push(``);

    // Bodies for top symbols only
    parts.push(`### Symbol bodies (selected)`);
    parts.push(``);
    let bodyCount = 0;
    for (const hit of rankedSyms) {
      if (bodyCount >= 6) break;
      const src = contentByRel.get(hit.file);
      if (!src) continue;
      const body = symbolBody(src, hit.symbol, 1600);
      if (chars + body.length > maxChars && bodyCount >= 2) break;
      parts.push(`#### ${hit.file} :: ${hit.symbol.kind} ${hit.symbol.name} (L${hit.symbol.startLine})`);
      if (hit.reasons?.length) parts.push(`Why: ${hit.reasons.slice(0, 3).join("; ")}`);
      parts.push("```");
      parts.push(body.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
      chars += body.length;
      bodyCount++;
    }

    // File outlines for files with many symbols but no body yet
    const outlineFiles = (project.symbolIndex.files || [])
      .filter((f) => usedFiles.has(f.rel) || terms.some((t) => f.rel.toLowerCase().includes(t)))
      .slice(0, 4);
    if (outlineFiles.length) {
      parts.push(`### File symbol maps`);
      for (const f of outlineFiles) {
        if (!f.outline) continue;
        const block = `// ${f.rel}\n${f.outline}`;
        if (chars + block.length > maxChars + 4000) break;
        parts.push("```");
        parts.push(block);
        parts.push("```");
        parts.push("");
        usedFiles.add(f.rel);
        chars += block.length;
      }
    }
  }

  // --- File fallback / complement: metadata + top text hits ---
  const scored = project.files
    .map((f) => {
      const { score, reasons } = scoreFile(f, terms, query);
      // Boost files that already have matching symbols
      const symBoost = rankedSyms.some((h) => h.file === f.rel) ? 8 : 0;
      return { ...f, score: score + symBoost, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const filePicks = [];
  for (const f of scored) {
    if (filePicks.length >= (rankedSyms.length ? 3 : 6)) break;
    if (f.score <= 0 && filePicks.length >= 2) break;
    // Prefer outline over full body when we already have symbols from this file
    const hasSym = rankedSyms.some((h) => h.file === f.rel);
    const idxFile = (project.symbolIndex?.files || []).find((x) => x.rel === f.rel);
    let content;
    if (hasSym && idxFile?.outline) {
      content = `// outline only (bodies above)\n${idxFile.outline}`;
    } else {
      content = truncate(f.content, rankedSyms.length ? 1200 : 2000);
    }
    if (chars + content.length > maxChars + 2000 && filePicks.length >= 1) break;
    filePicks.push({
      rel: f.rel,
      content,
      score: f.score,
      reasons: f.reasons.slice(0, 4),
    });
    chars += content.length;
    usedFiles.add(f.rel);
    evidence.push({
      path: f.rel,
      score: Math.round(f.score * 10) / 10,
      reasons: f.reasons.slice(0, 3),
      kind: "file",
    });
  }

  for (const must of ["package.json", "README.md", "readme.md"]) {
    if ([...usedFiles].some((u) => u === must || u.endsWith("/" + must))) continue;
    const hit = project.files.find((f) => f.rel === must || f.rel.endsWith("/" + must));
    if (hit) {
      filePicks.unshift({
        rel: hit.rel,
        content: truncate(hit.content, 1200),
        score: 0,
        reasons: ["project metadata"],
      });
      usedFiles.add(hit.rel);
    }
  }

  if (filePicks.length) {
    parts.push(`### Supporting files`);
    parts.push(``);
    for (const f of filePicks) {
      parts.push(`#### ${f.rel}`);
      if (f.reasons?.length) parts.push(`Why: ${f.reasons.join("; ")}`);
      parts.push("```");
      parts.push(f.content.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
    }
  }

  if (!usedFiles.size && project.files[0]) {
    mode = "fallback";
    const f = project.files[0];
    parts.push(`### Fallback file`);
    parts.push("```");
    parts.push(truncate(f.content, 1500));
    parts.push("```");
    usedFiles.add(f.rel);
    evidence.push({ path: f.rel, score: 0, reasons: ["fallback"], kind: "file" });
  }

  parts.push(
    `### How to use this context`,
    `- Working directory: ${project.path}`,
    `- Prefer the listed symbol definitions (name + path + line).`,
    `- Open additional files from the tree if needed; do not invent APIs.`,
    `- Context mode: ${mode}`
  );

  const text = parts.join("\n");
  return {
    text,
    usedFiles: [...usedFiles],
    evidence,
    promptTokens: estimateTokens(text),
    empty: usedFiles.size === 0,
    mode,
    symbolHits: rankedSyms.length,
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
