/**
 * Unified retrieval: lexical symbols + graph expansion + supporting files.
 * Returns structured evidence report for prompts and eval.
 */

import { expandFromSeeds } from "./graph.js";
import { rankSymbols, symbolBody } from "./symbols.js";
import { estimateTokens } from "./tokens.js";

/**
 * @param {object} project - in-memory project record
 * @param {string} query
 * @param {{
 *   maxChars?: number,
 *   includePaths?: string[],
 *   excludePaths?: string[],
 * }} [opts]
 */
export function retrieve(project, query, opts = {}) {
  if (!project) {
    return emptyResult();
  }

  const maxChars = opts.maxChars ?? 16000;
  const include = new Set((opts.includePaths || []).map(norm));
  const exclude = new Set((opts.excludePaths || []).map(norm));
  const contentByRel = new Map(project.files.map((f) => [norm(f.rel), f.content]));
  const terms = tokenize(query);

  const rankedSyms = project.symbolIndex?.symbolCount
    ? rankSymbols(project.symbolIndex, query, { max: 16 })
    : [];

  // Force-include pins
  for (const p of include) {
    if (!contentByRel.has(p)) continue;
  }

  const seedFiles = new Set();
  for (const h of rankedSyms) seedFiles.add(norm(h.file));

  // Lexical file seeds
  const fileScores = project.files
    .map((f) => {
      const rel = norm(f.rel);
      if (exclude.has(rel)) return null;
      const { score, reasons } = scoreFile(f, terms, query);
      const symBoost = rankedSyms.some((h) => norm(h.file) === rel) ? 8 : 0;
      const pinBoost = include.has(rel) ? 50 : 0;
      return { rel, score: score + symBoost + pinBoost, reasons, content: f.content };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  for (const f of fileScores.slice(0, 6)) {
    if (f.score > 0 || include.has(f.rel)) seedFiles.add(f.rel);
  }
  for (const p of include) seedFiles.add(p);

  // Graph expansion
  const symbolNames = rankedSyms.map((h) => h.symbol.name);
  const expanded = project.graph
    ? expandFromSeeds(project.graph, [...seedFiles], {
        symbolNames,
        maxExpand: 8,
      }).filter((e) => !exclude.has(norm(e.file)))
    : [];

  for (const e of expanded) seedFiles.add(norm(e.file));

  /** @type {import('./retrieve.js').EvidenceItem[]} */
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

  // Supporting: package.json, README, config
  for (const must of ["package.json", "README.md", "readme.md"]) {
    const hit = project.files.find((f) => norm(f.rel) === must || norm(f.rel).endsWith("/" + must));
    if (!hit) continue;
    const rel = norm(hit.rel);
    if (exclude.has(rel) || seedFiles.has(rel)) continue;
    supporting.push({
      path: rel,
      file: rel,
      kind: "file",
      tier: "supporting",
      score: 0,
      reasons: ["conventional project metadata"],
    });
    seedFiles.add(rel);
  }

  // Build prompt text with tier labels
  const treeLines = (project.tree || "").split("\n").slice(0, 50).join("\n");
  const parts = [
    `## Attached project (local context layer)`,
    `Path: ${project.path}`,
    `Name: ${project.name}`,
    `Symbol engine: ${project.symbolIndex?.symbolCount ? "tree-sitter" : "file-text fallback"}`,
    `Symbols indexed: ${project.symbolIndex?.symbolCount || 0}`,
    `Retrieval: lexical symbols + graph expansion (imports/tests/references)`,
    ``,
    `### Evidence summary`,
    `- Direct matches: ${direct.length}`,
    `- Graph-expanded: ${graphEv.length}`,
    `- Supporting: ${supporting.length}`,
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
    parts.push(`These were not top lexical hits but are linked via imports, importers, tests, or symbol references.`);
    parts.push(``);
    let gCount = 0;
    for (const e of graphEv) {
      if (gCount >= 5) break;
      const rel = norm(e.file);
      const src = contentByRel.get(rel);
      if (!src) continue;
      // Prefer outline if available
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

  // Supporting + remaining high file scores
  const supportFiles = [
    ...supporting.map((s) => s.file),
    ...fileScores
      .filter((f) => f.score > 0 && !usedFiles.has(f.rel) && !exclude.has(f.rel))
      .slice(0, 2)
      .map((f) => f.rel),
  ];

  if (supportFiles.length) {
    parts.push(`### Supporting files`);
    parts.push(``);
    for (const rel0 of supportFiles) {
      const rel = norm(rel0);
      const src = contentByRel.get(rel);
      if (!src || usedFiles.has(rel)) continue;
      const content = truncate(src, 1000);
      if (chars + content.length > maxChars + 3000) break;
      parts.push(`#### ${rel}`);
      parts.push(`Tier: supporting`);
      parts.push("```");
      parts.push(content.replace(/\n$/, ""));
      parts.push("```");
      parts.push("");
      chars += content.length;
      usedFiles.add(rel);
      if (!supporting.some((s) => s.file === rel)) {
        supporting.push({
          path: rel,
          file: rel,
          kind: "file",
          tier: "supporting",
          score: 0,
          reasons: ["lexical file complement"],
        });
      }
    }
  }

  // Pins forced in
  for (const rel of include) {
    if (usedFiles.has(rel) || !contentByRel.has(rel)) continue;
    const content = truncate(contentByRel.get(rel), 1500);
    parts.push(`#### ${rel}`);
    parts.push(`Tier: pinned by user`);
    parts.push("```");
    parts.push(content.replace(/\n$/, ""));
    parts.push("```");
    parts.push("");
    usedFiles.add(rel);
    direct.push({
      path: rel,
      file: rel,
      kind: "file",
      tier: "direct",
      score: 100,
      reasons: ["user pin"],
    });
  }

  if (!usedFiles.size && project.files[0]) {
    const f = project.files[0];
    const rel = norm(f.rel);
    parts.push(`### Fallback`);
    parts.push("```");
    parts.push(truncate(f.content, 1200));
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

  // Omitted note: high-scoring files we didn't include due to budget
  const omitted = fileScores
    .filter((f) => f.score > 2 && !usedFiles.has(f.rel) && !exclude.has(f.rel))
    .slice(0, 8)
    .map((f) => ({ path: f.rel, reason: "budget or lower rank", score: f.score }));

  parts.push(`### Retrieval report`);
  parts.push(`- Direct: ${[...usedFiles].filter((u) => direct.some((d) => d.file === u || d.path.startsWith(u))).length ? "see above" : "none"}`);
  parts.push(`- Expanded files: ${graphEv.map((g) => g.file).join(", ") || "none"}`);
  parts.push(`- Supporting: ${supporting.map((s) => s.file).join(", ") || "none"}`);
  if (omitted.length) {
    parts.push(`- Omitted (budget/rank): ${omitted.map((o) => o.path).join(", ")}`);
  }
  if (exclude.size) {
    parts.push(`- User excluded: ${[...exclude].join(", ")}`);
  }
  parts.push(``);
  parts.push(`### How to use`);
  parts.push(`- Working directory: ${project.path}`);
  parts.push(`- Treat "direct" evidence as primary; "expanded" as related modification sites.`);
  parts.push(`- Do not invent files. Open omitted paths if the task needs them.`);

  const text = parts.join("\n");
  const evidence = [...direct, ...graphEv, ...supporting];

  return {
    text,
    usedFiles: [...usedFiles],
    evidence,
    promptTokens: estimateTokens(text),
    empty: usedFiles.size === 0,
    mode: rankedSyms.length ? "symbol+graph" : graphEv.length ? "lexical+graph" : "lexical",
    symbolHits: rankedSyms.length,
    report: {
      direct,
      expanded: graphEv,
      supporting,
      omitted,
      excluded: [...exclude],
      pinned: [...include],
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
    report: { direct: [], expanded: [], supporting: [], omitted: [], excluded: [], pinned: [] },
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

function scoreFile(f, terms, rawQuery) {
  const pathL = norm(f.rel).toLowerCase();
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
    } else if (pathL.includes(t)) score += 3;
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
  return { score, reasons: [...new Set(reasons)] };
}

function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n… [truncated]";
}
