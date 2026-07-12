/**
 * Project attach + query-aware context slices for Prompter.
 * All local. No network.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildLightweightIndex } from "./index-project.js";
import { isForbiddenAttachRoot } from "./security-path.js";
import { retrieve } from "./retrieve.js";
import { isTreeSitterAvailable } from "./symbols.js";

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
 * Attach a folder: lightweight whole-tree index (no global 6MB body budget).
 * Full file bodies are loaded lazily at query time for selected evidence only.
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
async function buildProjectRecord(rootPath, keepId, _opts = {}) {
  const index = await buildLightweightIndex(rootPath);

  return {
    id: keepId || crypto.randomBytes(8).toString("hex"),
    path: index.root,
    name: index.root.split(/[/\\]/).filter(Boolean).pop() || index.root,
    tree: index.tree,
    // lightweight file metadata only (no content)
    files: index.files,
    stats: index.stats,
    skippedCount: index.skippedCount,
    symbolIndex: index.symbolIndex,
    graph: index.graph,
    indexMode: "lightweight",
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
    indexMode: record.indexMode || "lightweight",
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
 * Rank symbols + graph-expanded files against the user request.
 * Lazily loads only selected file bodies from disk.
 * @param {object} project
 * @param {string} query
 * @param {{ maxFiles?: number, maxChars?: number, includePaths?: string[], excludePaths?: string[] }} [opts]
 */
export async function buildContextForQuery(project, query, opts = {}) {
  return retrieve(project, query, opts);
}
