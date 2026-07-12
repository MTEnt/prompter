/**
 * Tree-sitter symbol index for Prompter.
 * Local only. Parses source into functions/classes/methods for grounded context.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "../..");

const EXT_TO_WASM = {
  ".js": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".py": "tree-sitter-python.wasm",
  ".go": "tree-sitter-go.wasm",
  ".rs": "tree-sitter-rust.wasm",
  ".java": "tree-sitter-java.wasm",
  ".rb": "tree-sitter-ruby.wasm",
  ".php": "tree-sitter-php.wasm",
  ".cs": "tree-sitter-c-sharp.wasm",
  ".cpp": "tree-sitter-cpp.wasm",
  ".cc": "tree-sitter-cpp.wasm",
  ".cxx": "tree-sitter-cpp.wasm",
  ".h": "tree-sitter-cpp.wasm",
  ".hpp": "tree-sitter-cpp.wasm",
  ".css": "tree-sitter-css.wasm",
  ".sh": "tree-sitter-bash.wasm",
  ".bash": "tree-sitter-bash.wasm",
};

/** Node types that define a named symbol (multi-language). */
const SYMBOL_TYPES = new Set([
  // JS / TS
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "abstract_class_declaration",
  // Python
  "function_definition",
  "class_definition",
  "decorated_definition",
  // Go
  "method_declaration",
  "type_declaration",
  // Rust
  "function_item",
  "impl_item",
  "struct_item",
  "enum_item",
  "trait_item",
  "mod_item",
  // Java / C#
  "method_declaration",
  "constructor_declaration",
  "class_declaration",
  "interface_declaration",
  // Ruby
  "method",
  "singleton_method",
  "class",
  "module",
]);

const KIND_MAP = {
  function_declaration: "function",
  generator_function_declaration: "function",
  function_definition: "function",
  function_item: "function",
  method_definition: "method",
  method_declaration: "method",
  method: "method",
  singleton_method: "method",
  constructor_declaration: "constructor",
  class_declaration: "class",
  class_definition: "class",
  abstract_class_declaration: "class",
  class: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  enum_item: "enum",
  struct_item: "struct",
  trait_item: "trait",
  impl_item: "impl",
  mod_item: "module",
  module: "module",
  type_declaration: "type",
  decorated_definition: "function",
};

let Parser;
let Language;
let initPromise;
/** @type {Map<string, any>} */
const langCache = new Map();

function wasmDir() {
  try {
    const pkg = require.resolve("@vscode/tree-sitter-wasm/package.json");
    return path.join(path.dirname(pkg), "wasm");
  } catch {
    return path.join(ROOT, "node_modules/@vscode/tree-sitter-wasm/wasm");
  }
}

function coreWasm() {
  try {
    return require.resolve("web-tree-sitter/web-tree-sitter.wasm");
  } catch {
    return path.join(ROOT, "node_modules/web-tree-sitter/web-tree-sitter.wasm");
  }
}

async function ensureParser() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const wts = await import("web-tree-sitter");
    Parser = wts.Parser;
    Language = wts.Language;
    await Parser.init({
      locateFile: (scriptName) => {
        if (scriptName.endsWith(".wasm")) return coreWasm();
        return path.join(path.dirname(coreWasm()), scriptName);
      },
    });
    return true;
  })();
  return initPromise;
}

async function loadLanguage(wasmName) {
  if (langCache.has(wasmName)) return langCache.get(wasmName);
  await ensureParser();
  const file = path.join(wasmDir(), wasmName);
  const lang = await Language.load(file);
  langCache.set(wasmName, lang);
  return lang;
}

function childNamed(node, type) {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

function findNameNode(node) {
  // Common field / child patterns across grammars
  const prefer = ["name", "property", "identifier", "type_identifier", "constant"];
  for (const p of prefer) {
    try {
      const f = node.childForFieldName?.(p);
      if (f) return f;
    } catch {
      /* ignore */
    }
  }
  for (const t of [
    "identifier",
    "property_identifier",
    "type_identifier",
    "constant",
    "name",
  ]) {
    const c = childNamed(node, t);
    if (c) return c;
  }
  // class Foo / function foo
  for (let i = 0; i < Math.min(node.childCount, 6); i++) {
    const c = node.child(i);
    if (!c) continue;
    if (
      c.type === "identifier" ||
      c.type === "property_identifier" ||
      c.type === "type_identifier" ||
      c.type === "constant"
    ) {
      return c;
    }
  }
  return null;
}

function signatureOf(node, source) {
  const start = node.startIndex;
  const end = Math.min(node.endIndex, start + 240);
  let sig = source.slice(start, end);
  // Prefer first line / until opening brace for multi-line
  const brace = sig.indexOf("{");
  if (brace > 0 && brace < 200) sig = sig.slice(0, brace).trimEnd() + " { … }";
  else {
    const nl = sig.indexOf("\n");
    if (nl > 0) sig = sig.slice(0, nl).trimEnd() + " …";
  }
  return sig.replace(/\s+/g, " ").trim();
}

function bodySlice(node, source, maxChars = 1800) {
  const text = source.slice(node.startIndex, node.endIndex);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n… [truncated]";
}

/**
 * Extract symbols from one source file.
 * @param {string} rel
 * @param {string} source
 * @returns {Promise<{ symbols: object[], outline: string, engine: string }>}
 */
export async function extractSymbols(rel, source) {
  const ext = path.extname(rel).toLowerCase();
  const wasm = EXT_TO_WASM[ext];
  if (!wasm || !source || source.length > 400_000) {
    return { symbols: [], outline: "", engine: "none" };
  }

  try {
    await ensureParser();
    const language = await loadLanguage(wasm);
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    /** @type {object[]} */
    const symbols = [];

    function visit(node, depth = 0) {
      if (!node || depth > 40) return;
      if (SYMBOL_TYPES.has(node.type)) {
        // Unwrap decorated_definition / export wrappers handled by walking children too
        let target = node;
        if (node.type === "decorated_definition") {
          const inner =
            childNamed(node, "function_definition") ||
            childNamed(node, "class_definition");
          if (inner) target = inner;
        }

        const nameNode = findNameNode(target);
        const name = nameNode?.text || "(anonymous)";
        const kind = KIND_MAP[target.type] || target.type;
        const startLine = target.startPosition.row + 1;
        const endLine = target.endPosition.row + 1;
        const signature = signatureOf(target, source);

        // Skip tiny anonymous noise
        if (!(name === "(anonymous)" && endLine - startLine < 2)) {
          symbols.push({
            name,
            kind,
            startLine,
            endLine,
            signature,
            // defer body until selected
            startIndex: target.startIndex,
            endIndex: target.endIndex,
          });
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        visit(node.child(i), depth + 1);
      }
    }

    visit(tree.rootNode);

    // lexical const foo = () => — capture named arrows / functions
    // already covered partially if we walk lexical_declaration; add explicit pass
    // (optional) already have methods/functions

    // Dedupe by name+startLine
    const seen = new Set();
    const uniq = [];
    for (const s of symbols) {
      const k = `${s.kind}:${s.name}:${s.startLine}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(s);
    }

    const outline = uniq
      .slice(0, 80)
      .map((s) => `  ${s.kind} ${s.name}  L${s.startLine}  ${s.signature}`)
      .join("\n");

    return { symbols: uniq, outline, engine: "tree-sitter" };
  } catch (e) {
    return { symbols: [], outline: "", engine: "error", error: String(e.message || e) };
  }
}

/**
 * Build symbol index for many files (bounded concurrency).
 * @param {{ rel: string, content: string }[]} files
 * @param {{ concurrency?: number }} [opts]
 */
export async function indexFiles(files, opts = {}) {
  const concurrency = opts.concurrency ?? 6;
  const out = [];
  let i = 0;
  let engineOk = 0;
  let engineFail = 0;

  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx];
      if (!f?.content) continue;
      const ext = path.extname(f.rel).toLowerCase();
      if (!EXT_TO_WASM[ext]) continue;
      const result = await extractSymbols(f.rel, f.content);
      if (result.engine === "tree-sitter" && result.symbols.length) {
        engineOk++;
        out.push({
          rel: f.rel,
          symbols: result.symbols,
          outline: result.outline,
        });
      } else if (result.engine === "error") {
        engineFail++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    files: out,
    symbolCount: out.reduce((n, f) => n + f.symbols.length, 0),
    parsedFiles: out.length,
    engineOk,
    engineFail,
  };
}

/**
 * Get body text for a symbol from original file content.
 */
export function symbolBody(fileContent, symbol, maxChars = 1800) {
  if (!fileContent || symbol.startIndex == null) return symbol.signature;
  const text = fileContent.slice(symbol.startIndex, symbol.endIndex);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n… [truncated]";
}

/**
 * Rank symbols against a query.
 */
export function rankSymbols(symbolIndex, query, opts = {}) {
  const max = opts.max ?? 12;
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length > 2);

  /** @type {{ file: string, symbol: object, score: number, reasons: string[] }[]} */
  const scored = [];
  for (const f of symbolIndex.files || []) {
    for (const s of f.symbols) {
      let score = 0;
      const reasons = [];
      const nameL = s.name.toLowerCase();
      const sigL = (s.signature || "").toLowerCase();
      for (const t of terms) {
        if (nameL === t) {
          score += 20;
          reasons.push(`exact name ${t}`);
        } else if (nameL.includes(t)) {
          score += 12;
          reasons.push(`name~${t}`);
        } else if (sigL.includes(t)) {
          score += 4;
          reasons.push(`sig~${t}`);
        }
        if (f.rel.toLowerCase().includes(t)) score += 2;
      }
      // camelCase pieces
      const parts = s.name.split(/(?=[A-Z])/).map((p) => p.toLowerCase());
      for (const t of terms) {
        if (parts.includes(t)) {
          score += 8;
          reasons.push(`camel~${t}`);
        }
      }
      if (score > 0) {
        scored.push({ file: f.rel, symbol: s, score, reasons: [...new Set(reasons)] });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

export function isTreeSitterAvailable() {
  try {
    require.resolve("web-tree-sitter");
    require.resolve("@vscode/tree-sitter-wasm/package.json");
    return true;
  } catch {
    return false;
  }
}
