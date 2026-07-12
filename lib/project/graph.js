/**
 * Lightweight relationship index for graph expansion after lexical/symbol hits.
 * JS/TS first: imports, exports, require, test association by name/path.
 * Approximate — not full static analysis.
 */

import path from "node:path";

const CODE_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
]);

/**
 * @param {{ rel: string, content: string }[]} files
 */
export function buildGraphIndex(files) {
  /** @type {Map<string, { imports: string[], exports: string[], identifiers: Set<string>, isTest: boolean }>} */
  const byRel = new Map();
  const basenames = new Map(); // basename without ext -> [rel]

  for (const f of files) {
    const rel = f.rel.replace(/\\/g, "/");
    const ext = path.extname(rel).toLowerCase();
    const base = path.posix.basename(rel, ext);
    if (!basenames.has(base)) basenames.set(base, []);
    basenames.get(base).push(rel);

    const isTest = /\.(test|spec)\./i.test(rel) || /(^|\/)(tests?|__tests__)\//i.test(rel);
    const imports = [];
    const exports = [];
    const identifiers = new Set();

    if (CODE_EXT.has(ext) && f.content) {
      parseJsTsEdges(f.content, rel, imports, exports, identifiers);
      if (ext === ".py") parsePyEdges(f.content, imports, identifiers);
    }

    byRel.set(rel, { imports, exports, identifiers, isTest });
  }

  // Resolve relative import strings to repo paths
  for (const [rel, meta] of byRel) {
    meta.resolvedImports = meta.imports
      .map((spec) => resolveImport(rel, spec, byRel, basenames))
      .filter(Boolean);
  }

  // Reverse edges: who imports me
  /** @type {Map<string, string[]>} */
  const importedBy = new Map();
  for (const [rel, meta] of byRel) {
    for (const imp of meta.resolvedImports || []) {
      if (!importedBy.has(imp)) importedBy.set(imp, []);
      importedBy.get(imp).push(rel);
    }
  }

  return { byRel, importedBy, basenames };
}

function parseJsTsEdges(content, rel, imports, exports, identifiers) {
  const text = content.slice(0, 120_000);
  // import ... from 'x'
  const fromRe = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = fromRe.exec(text))) {
    const spec = m[1];
    if (m[0].startsWith("export") && m[0].includes("from")) exports.push(spec);
    else imports.push(spec);
  }
  // require('x') / import('x')
  const reqRe = /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reqRe.exec(text))) imports.push(m[1]);

  // crude identifier harvest (for tests/call-site hints)
  const idRe = /\b([A-Z][a-zA-Z0-9]{2,}|[a-z][a-zA-Z0-9]{3,})\b/g;
  let n = 0;
  while ((m = idRe.exec(text)) && n < 400) {
    const id = m[1];
    if (STOP.has(id.toLowerCase())) continue;
    identifiers.add(id);
    n++;
  }
}

function parsePyEdges(content, imports, identifiers) {
  const text = content.slice(0, 80_000);
  const fromRe = /^\s*from\s+([\w.]+)\s+import\s+/gm;
  const impRe = /^\s*import\s+([\w.]+)/gm;
  let m;
  while ((m = fromRe.exec(text))) imports.push(m[1].replace(/\./g, "/"));
  while ((m = impRe.exec(text))) imports.push(m[1].replace(/\./g, "/"));
  const idRe = /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g;
  let n = 0;
  while ((m = idRe.exec(text)) && n < 300) {
    if (!STOP.has(m[1].toLowerCase())) identifiers.add(m[1]);
    n++;
  }
}

function resolveImport(fromRel, spec, byRel, basenames) {
  if (!spec || spec.startsWith("http")) return null;
  // relative
  if (spec.startsWith(".")) {
    const dir = path.posix.dirname(fromRel);
    let cand = path.posix.normalize(path.posix.join(dir, spec));
    const tryPaths = [
      cand,
      cand + ".js",
      cand + ".ts",
      cand + ".tsx",
      cand + ".jsx",
      cand + ".mjs",
      cand + "/index.js",
      cand + "/index.ts",
      cand + "/index.tsx",
    ];
    for (const t of tryPaths) {
      if (byRel.has(t)) return t;
    }
    // match without extension
    for (const key of byRel.keys()) {
      if (key === cand || key.startsWith(cand + ".") || key.startsWith(cand + "/")) return key;
    }
    return null;
  }
  // bare / package — skip node_modules
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    // try path-like internal aliases src/foo
    if (byRel.has(spec)) return spec;
    const base = spec.split("/").pop();
    const hits = basenames.get(base);
    if (hits?.length === 1) return hits[0];
  }
  return null;
}

const STOP = new Set([
  "const", "let", "var", "function", "return", "import", "export", "from", "class",
  "async", "await", "true", "false", "null", "undefined", "this", "new", "typeof",
  "string", "number", "boolean", "object", "array", "promise", "module", "require",
  "default", "extends", "implements", "interface", "type", "enum", "public", "private",
  "static", "void", "with", "for", "while", "switch", "case", "break", "continue",
  "if", "else", "try", "catch", "throw", "finally", "yield", "super", "package",
]);

/**
 * Expand seed files via graph relationships.
 * @param {ReturnType<typeof buildGraphIndex>} graph
 * @param {string[]} seedFiles
 * @param {{ symbolNames?: string[], maxExpand?: number }} [opts]
 * @returns {{ file: string, reason: string, tier: string }[]}
 */
export function expandFromSeeds(graph, seedFiles, opts = {}) {
  const maxExpand = opts.maxExpand ?? 8;
  const symbolNames = (opts.symbolNames || []).map((s) => s.toLowerCase());
  const seeds = new Set(seedFiles.map((f) => f.replace(/\\/g, "/")));
  /** @type {{ file: string, reason: string, tier: string }[]} */
  const out = [];
  const seen = new Set(seeds);

  function add(file, reason, tier) {
    if (!file || seen.has(file) || !graph.byRel.has(file)) return;
    if (out.length >= maxExpand) return;
    seen.add(file);
    out.push({ file, reason, tier });
  }

  for (const seed of seeds) {
    const meta = graph.byRel.get(seed);
    if (!meta) continue;
    // imports of seed
    for (const imp of meta.resolvedImports || []) {
      add(imp, `imported by ${seed}`, "graph-import");
    }
    // importers of seed
    for (const parent of graph.importedBy.get(seed) || []) {
      add(parent, `imports ${seed}`, "graph-imported-by");
    }
  }

  // tests that mention seed basenames or symbol names
  for (const [rel, meta] of graph.byRel) {
    if (!meta.isTest) continue;
    if (seen.has(rel)) continue;
    for (const seed of seeds) {
      const base = path.posix.basename(seed).replace(/\.[^.]+$/, "");
      if (rel.toLowerCase().includes(base.toLowerCase())) {
        add(rel, `test associated with ${seed}`, "graph-test");
      }
    }
    if (symbolNames.length) {
      for (const id of meta.identifiers) {
        if (symbolNames.includes(id.toLowerCase())) {
          add(rel, `test references ${id}`, "graph-test");
          break;
        }
      }
    }
  }

  // sibling files that reference matched symbols (call sites)
  if (symbolNames.length) {
    for (const [rel, meta] of graph.byRel) {
      if (seen.has(rel) || meta.isTest) continue;
      for (const id of meta.identifiers) {
        if (symbolNames.includes(id.toLowerCase())) {
          add(rel, `references symbol ${id}`, "graph-reference");
          break;
        }
      }
      if (out.length >= maxExpand) break;
    }
  }

  return out;
}
