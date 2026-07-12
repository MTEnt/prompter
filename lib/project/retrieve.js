/**
 * Unified retrieval: lexical symbols + graph expansion + supporting files.
 * Bodies are loaded lazily from disk for selected paths only.
 */

import { expandFromSeeds } from "./graph.js";
import { loadBodies } from "./index-project.js";
import { rankSymbols, symbolBody } from "./symbols.js";
import { estimateTokens } from "./tokens.js";

/**
 * @param {object} project - lightweight project record (no full bodies)
 * @param {string} query
 * @param {{
 *   maxChars?: number,
 *   includePaths?: string[],
 *   excludePaths?: string[],
 * }} [opts]
 */
export async function retrieve(project, query, opts = {}) {
  if (!project) {
    return emptyResult();
  }

  const maxChars = opts.maxChars ?? 16000;
  const include = new Set((opts.includePaths || []).map(norm));
  const exclude = new Set((opts.excludePaths || []).map(norm));
  const terms = tokenize(query);

  const rankedSyms = project.symbolIndex?.symbolCount
    ? rankSymbols(project.symbolIndex, query, { max: 16 })
    : [];

  const seedFiles = new Set();
  for (const h of rankedSyms) seedFiles.add(norm(h.file));

  // Lexical / metadata scoring over full index (no bodies needed)
  const fileScores = project.files
    .map((f) => {
      const rel = norm(f.rel);
      if (exclude.has(rel)) return null;
      const { score, reasons } = scoreFileMeta(f, terms, query);
      const symBoost = rankedSyms.some((h) => norm(h.file) === rel) ? 8 : 0;
      const pinBoost = include.has(rel) ? 50 : 0;
      return { rel, score: score + symBoost + pinBoost, reasons };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  for (const f of fileScores.slice(0, 8)) {
    if (f.score > 0 || include.has(f.rel)) seedFiles.add(f.rel);
  }
  for (const p of include) seedFiles.add(p);

  const symbolNames = rankedSyms.map((h) => h.symbol.name);
  const expanded = project.graph
    ? expandFromSeeds(project.graph, [...seedFiles], {
        symbolNames,
        maxExpand: 10,
      }).filter((e) => !exclude.has(norm(e.file)))
    : [];

  for (const e of expanded) seedFiles.add(norm(e.file));

  // Supporting metadata files always candidates
  for (const must of ["package.json", "README.md", "readme.md"]) {
    const hit = project.files.find((f) => {
      const r = norm(f.rel);
      return r === must || r.endsWith("/" + must);
    });
    if (hit && !exclude.has(norm(hit.rel))) seedFiles.add(norm(hit.rel));
  }

  // --- Lazy load only selected bodies ---
  const toLoad = [...seedFiles];
  const contentByRel = await loadBodies(project, toLoad);

  /** @type {object[]} */
  const direct = [];
  const graphEv = [];
  const supporting = [];

  for (const h of rankedSyms.slice(0, 12)) {
    if (exclude.has(norm(h.file))) continue;
    direct.push({
      path: `${h.file} :: ${h.symbol.kind} ${h.symbol.name}`,
      file: h.file,
      symbol: h.symbol.name,
      kind: "symbol",
      tier: "direct",
      score: h.score,
      reasons: h.reasons || [],
    });
  }

  for (const e of expanded) {
    graphEv.push({
      path: e.file,
      file: e.file,
      kind: "file",
      tier: "expanded",
      score: 0,
      reasons: [e.reason],
    });
  }

  for (const must of ["package.json", "README.md", "readme.md"]) {
    const hit = project.files.find((f) => {
      const r = norm(f.rel);
      return r === must || r.endsWith("/" + must);
    });
    if (!hit) continue;
    const rel = norm(hit.rel);
    if (exclude.has(rel)) continue;
    if (![...direct, ...graphEv].some((x) => norm(x.file) === rel)) {
      supporting.push({
        path: rel,
        file: rel,
        kind: "file",
        tier: "supporting",
        score: 0,
        reasons: ["conventional project metadata"],
      });
    }
  }

  const treeLines = (project.tree || "").split("\n").slice(0, 50).join("\n");
  const parts = [
    `## Attached project (local context layer)`,
    `Path: ${project.path}`,
    `Name: ${project.name}`,
    `Index mode: lightweight (full tree metadata; bodies loaded for selected evidence only)`,
    `Files indexed: ${project.files?.length || 0}`,
    `Symbol engine: ${project.symbolIndex?.symbolCount ? "tree-sitter" : "file-text fallback"}`,
    `Symbols indexed: ${project.symbolIndex?.symbolCount || 0}`,
    `Retrieval: lexical symbols + graph expansion; lazy body load`,
    ``,
    `### Evidence summary`,
    `- Direct matches: ${direct.length}`,
    `- Graph-expanded: ${graphEv.length}`,
    `- Supporting: ${supporting.length}`,
    `- Bodies loaded from disk: ${contentByRel.size}`,
    ``,
    `### Directory tree (partial)`,
    "```",
    treeLines,
    "```",
    ``,
  ];

  let chars = 0;
  const usedFiles = new Set();

  if (direct.length) {
    parts.push(`### Direct matches (query → symbols)`);
    parts.push(`Prefer these definitions over inventing APIs.`);
    parts.push(``);
    for (const d of direct.slice(0, 12)) {
      parts.push(`- \`${d.path}\` (${(d.reasons || []).slice(0, 2).join("; ") || "match"})`);
    }
    parts.push(``);

    parts.push(`### Direct symbol bodies`);
    parts.push(``);
    let bodyCount = 0;
    for (const h of rankedSyms) {
      if (bodyCount >= 6) break;
      if (exclude.has(norm(h.file))) continue;
      const src = contentByRel.get(norm(h.file));
      if (!src) continue;
      const body = symbolBody(src, h.symbol, 1500);
      if (chars + body.length > maxChars && bodyCount >= 2) break;
      parts.push(`#### ${h.file} :: ${h.symbol.kind} ${h.symbol.name} (L${h.symbol.startLine})`);
      parts.push(`Tier: direct`);
      parts.push("```");
      parts.push(body.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
      chars += body.length;
      bodyCount++;
      usedFiles.add(norm(h.file));
    }
  }

  if (graphEv.length) {
    parts.push(`### Graph-expanded context (related sites)`);
    parts.push(
      `Linked via imports, importers, tests, or symbol references — not only top lexical hits.`
    );
    parts.push(``);
    let gCount = 0;
    for (const e of graphEv) {
      if (gCount >= 5) break;
      const rel = norm(e.file);
      const src = contentByRel.get(rel);
      if (!src) continue;
      const idxFile = (project.symbolIndex?.files || []).find((x) => norm(x.rel) === rel);
      let content;
      if (idxFile?.outline) {
        content = `// ${rel}\n// why: ${e.reasons?.[0] || "graph"}\n${idxFile.outline}\n\n${truncate(src, 900)}`;
      } else {
        content = truncate(src, 1100);
      }
      if (chars + content.length > maxChars + 2000 && gCount >= 1) break;
      parts.push(`#### ${rel}`);
      parts.push(`Tier: expanded · ${e.reasons?.[0] || "graph"}`);
      parts.push("```");
      parts.push(content.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
      chars += content.length;
      gCount++;
      usedFiles.add(rel);
    }
  }

  const supportFiles = [
    ...supporting.map((s) => s.file),
    ...fileScores
      .filter((f) => f.score > 0 && !usedFiles.has(f.rel) && !exclude.has(f.rel))
      .slice(0, 2)
      .map((f) => f.rel),
    ...[...include].filter((p) => !usedFiles.has(p)),
  ];

  // Load any support files not already loaded
  const missingSupport = supportFiles.filter((r) => !contentByRel.has(norm(r)));
  if (missingSupport.length) {
    const extra = await loadBodies(project, missingSupport);
    for (const [k, v] of extra) contentByRel.set(k, v);
  }

  if (supportFiles.length) {
    parts.push(`### Supporting files`);
    parts.push(``);
    for (const rel0 of supportFiles) {
      const rel = norm(rel0);
      const src = contentByRel.get(rel);
      if (!src || usedFiles.has(rel)) continue;
      const content = truncate(src, 1000);
      if (chars + content.length > maxChars + 3000) break;
      const tier = include.has(rel) ? "pinned" : "supporting";
      parts.push(`#### ${rel}`);
      parts.push(`Tier: ${tier}`);
      parts.push("```");
      parts.push(content.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
      chars += content.length;
      usedFiles.add(rel);
      if (!supporting.some((s) => s.file === rel) && !include.has(rel)) {
        supporting.push({
          path: rel,
          file: rel,
          kind: "file",
          tier: "supporting",
          score: 0,
          reasons: ["lexical/metadata complement"],
        });
      }
      if (include.has(rel)) {
        direct.push({
          path: rel,
          file: rel,
          kind: "file",
          tier: "direct",
          score: 100,
          reasons: ["user pin"],
        });
      }
    }
  }

  if (!usedFiles.size && project.files[0]) {
    const f = project.files[0];
    const rel = norm(f.rel);
    const bodies = await loadBodies(project, [rel]);
    const src = bodies.get(rel) || "";
    parts.push(`### Fallback`);
    parts.push("```");
    parts.push(truncate(src, 1200));
    parts.push("```");
    usedFiles.add(rel);
    supporting.push({
      path: rel,
      file: rel,
      kind: "file",
      tier: "supporting",
      score: 0,
      reasons: ["fallback"],
    });
  }

  const omitted = fileScores
    .filter((f) => f.score > 2 && !usedFiles.has(f.rel) && !exclude.has(f.rel))
    .slice(0, 12)
    .map((f) => ({ path: f.rel, reason: "not selected for body load / budget", score: f.score }));

  parts.push(`### Retrieval report`);
  parts.push(`- Expanded files: ${graphEv.map((g) => g.file).join(", ") || "none"}`);
  parts.push(`- Supporting: ${supporting.map((s) => s.file).join(", ") || "none"}`);
  parts.push(`- Bodies loaded: ${contentByRel.size} (lazy, query-time)`);
  if (omitted.length) {
    parts.push(`- Omitted from prompt: ${omitted.map((o) => o.path).join(", ")}`);
  }
  if (exclude.size) {
    parts.push(`- User excluded: ${[...exclude].join(", ")}`);
  }
  parts.push(``);
  parts.push(`### How to use`);
  parts.push(`- Working directory: ${project.path}`);
  parts.push(`- Direct evidence is primary; expanded are related modification sites.`);
  parts.push(`- Index covers the full tree metadata; only selected bodies were read for this task.`);

  const text = parts.join("\n");
  const evidence = [...direct, ...graphEv, ...supporting];

  return {
    text,
    usedFiles: [...usedFiles],
    evidence,
    promptTokens: estimateTokens(text),
    empty: usedFiles.size === 0,
    mode: rankedSyms.length ? "symbol+graph+lazy" : graphEv.length ? "lexical+graph+lazy" : "lazy",
    symbolHits: rankedSyms.length,
    bodiesLoaded: contentByRel.size,
    report: {
      direct,
      expanded: graphEv,
      supporting,
      omitted,
      excluded: [...exclude],
      pinned: [...include],
      bodiesLoaded: contentByRel.size,
      indexedFiles: project.files?.length || 0,
    },
  };
}

function emptyResult() {
  return {
    text: "",
    usedFiles: [],
    evidence: [],
    promptTokens: 0,
    empty: true,
    mode: "none",
    symbolHits: 0,
    bodiesLoaded: 0,
    report: {
      direct: [],
      expanded: [],
      supporting: [],
      omitted: [],
      excluded: [],
      pinned: [],
      bodiesLoaded: 0,
      indexedFiles: 0,
    },
  };
}

function norm(p) {
  return String(p || "").replace(/\\/g, "/");
}

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "have",
  "want", "need", "make", "please", "just", "like", "some", "about", "when",
  "then", "than", "also", "using", "code", "file", "files", "project", "should",
  "could", "would", "there", "their", "what", "where", "which", "after", "before",
]);

/** Score without full file body — path + symbol names + identifier bag */
function scoreFileMeta(f, terms, rawQuery) {
  const pathL = norm(f.rel).toLowerCase();
  const base = pathL.split("/").pop() || pathL;
  const names = (f.symbolNames || []).map((n) => n.toLowerCase());
  const ids = (f.identifiers || []).map((n) => String(n).toLowerCase());
  let score = 0;
  const reasons = [];

  for (const t of terms) {
    if (base === t || base.startsWith(t + ".") || base.includes(t)) {
      score += 10;
      reasons.push(`name~${t}`);
    } else if (pathL.split(/[/_.-]/).includes(t)) {
      score += 7;
      reasons.push(`path~${t}`);
    } else if (pathL.includes(t)) score += 3;

    if (names.includes(t)) {
      score += 14;
      reasons.push(`symbol~${t}`);
    } else if (names.some((n) => n.includes(t))) {
      score += 8;
      reasons.push(`symbol-part~${t}`);
    }

    if (ids.includes(t)) {
      score += 3;
      reasons.push(`id~${t}`);
    }
  }

  const pathInQuery = rawQuery.match(/[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|md|css|html|json)\b/i);
  if (pathInQuery && pathL.includes(pathInQuery[0].toLowerCase())) {
    score += 20;
    reasons.push("exact path in request");
  }
  if (/\.(js|ts|tsx|jsx|py|go|rs)$/.test(pathL)) score += 0.3;
  return { score, reasons: [...new Set(reasons)] };
}

function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n… [truncated]";
}
