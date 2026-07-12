/**
 * Lightweight whole-repo index.
 * Walk all eligible files, parse symbols + graph edges, then discard full bodies.
 * Bodies are loaded lazily at query time for selected paths only.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IGNORE, DEFAULT_MAX_FILE_BYTES } from "./defaults.js";
import { buildGraphIndex } from "./graph.js";
import { scrubSecrets } from "./scrub.js";
import { extractSymbols, isTreeSitterAvailable } from "./symbols.js";
import { formatBytes, renderTree, walkTree } from "./walk.js";

const MAX_INDEX_FILES = 25_000;
const MAX_PARSE_BYTES = 160 * 1024;

/**
 * Build a lightweight project index over the full tree (no 6MB content budget).
 * @param {string} rootPath
 * @param {{ maxFileBytes?: number, maxFiles?: number }} [opts]
 */
export async function buildLightweightIndex(rootPath, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? Math.max(DEFAULT_MAX_FILE_BYTES, MAX_PARSE_BYTES);
  const maxFiles = opts.maxFiles ?? MAX_INDEX_FILES;

  const walked = await walkTree(rootPath, {
    defaultIgnore: DEFAULT_IGNORE,
    maxFileBytes,
    // walkTree currently loads all text; we use it then strip content
  });

  // Prefer indexing more files: walkTree already filtered. Cap count for safety.
  let candidates = walked.files;
  if (candidates.length > maxFiles) {
    // Keep source-weighted head of list rather than arbitrary slice
    candidates = [...candidates]
      .sort((a, b) => indexPriority(b) - indexPriority(a))
      .slice(0, maxFiles);
  }

  /** @type {{ rel: string, abs: string, size: number, lang: string, content?: string }[]} */
  const withContent = candidates.map((f) => ({
    rel: f.rel.replace(/\\/g, "/"),
    abs: f.abs,
    size: f.size,
    lang: path.extname(f.rel).toLowerCase(),
    content: f.text || "",
  }));

  // Symbol parse (needs content temporarily)
  const symbolFiles = [];
  let symbolCount = 0;
  if (isTreeSitterAvailable()) {
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < withContent.length) {
        const idx = i++;
        const f = withContent[idx];
        if (!f.content || f.content.length > 400_000) continue;
        try {
          const result = await extractSymbols(f.rel, f.content);
          if (result.engine === "tree-sitter" && result.symbols.length) {
            symbolFiles.push({
              rel: f.rel,
              symbols: result.symbols,
              outline: result.outline,
            });
            symbolCount += result.symbols.length;
          }
        } catch {
          /* skip file */
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  // Graph from temporary content
  let graph = null;
  try {
    graph = buildGraphIndex(
      withContent.map((f) => ({ rel: f.rel, content: f.content }))
    );
  } catch {
    graph = null;
  }

  // Lightweight file records (no full body kept)
  const files = withContent.map((f) => {
    const sym = symbolFiles.find((s) => s.rel === f.rel);
    const g = graph?.byRel?.get(f.rel);
    const hash = crypto
      .createHash("sha1")
      .update(f.content.slice(0, 64_000))
      .digest("hex")
      .slice(0, 12);
    return {
      rel: f.rel,
      abs: f.abs,
      size: f.size,
      lang: f.lang,
      hash,
      // scoring aids without body
      symbolNames: (sym?.symbols || []).map((s) => s.name),
      identifiers: g?.identifiers ? [...g.identifiers].slice(0, 80) : [],
      // never store content in the index
    };
  });

  const tree = renderTree(walked.treePaths);
  const indexedBytes = files.reduce((n, f) => n + (f.size || 0), 0);

  return {
    root: walked.root,
    tree,
    files,
    symbolIndex: {
      files: symbolFiles,
      symbolCount,
      parsedFiles: symbolFiles.length,
      engineOk: symbolFiles.length,
      engineFail: 0,
    },
    graph,
    skippedCount: walked.skippedCount + Math.max(0, walked.files.length - candidates.length),
    stats: {
      files: files.length,
      skipped: walked.skippedCount,
      bytes: indexedBytes,
      bytesLabel: formatBytes(indexedBytes),
      // "tokens" for UI = rough size of indexed corpus on disk, not resident RAM
      tokens: Math.round(indexedBytes / 4),
      redactions: [],
      mode: "lightweight-index",
    },
  };
}

function indexPriority(f) {
  let s = 0;
  const r = f.rel.toLowerCase();
  if (/\.(js|ts|tsx|jsx|py|go|rs|java|rb|php)$/.test(r)) s += 5;
  if (/(^|\/)(src|lib|app|server|api|components|pages|routes)\//.test(r)) s += 4;
  if (/^(readme|package\.json|cargo\.toml|go\.mod|pyproject)/i.test(r)) s += 6;
  if (/\.(md|txt|lock)$/.test(r) && !/readme/i.test(r)) s -= 2;
  return s;
}

/**
 * Lazily load + scrub file bodies for selected relative paths.
 * @param {object} project
 * @param {string[]} rels
 * @param {{ maxFileBytes?: number }} [opts]
 * @returns {Promise<Map<string, string>>}
 */
export async function loadBodies(project, rels, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? MAX_PARSE_BYTES;
  const byRel = new Map(project.files.map((f) => [f.rel.replace(/\\/g, "/"), f]));
  const out = new Map();
  const unique = [...new Set(rels.map((r) => String(r).replace(/\\/g, "/")))];

  await Promise.all(
    unique.map(async (rel) => {
      const meta = byRel.get(rel);
      if (!meta?.abs) return;
      try {
        const st = await fs.stat(meta.abs);
        if (st.size > maxFileBytes * 2) {
          // allow slightly larger on-demand than index parse cap
          const buf = await fs.readFile(meta.abs);
          const text = buf.slice(0, maxFileBytes * 2).toString("utf8");
          out.set(rel, scrubSecrets(text).text);
          return;
        }
        const raw = await fs.readFile(meta.abs, "utf8");
        out.set(rel, scrubSecrets(raw).text);
      } catch {
        /* missing on disk */
      }
    })
  );

  return out;
}
