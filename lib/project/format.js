import { estimateTokens, formatTokens } from "./tokens.js";
import { formatBytes } from "./walk.js";

/**
 * @param {object} pack
 * @param {"markdown"|"plain"|"json"|"xml"} style
 */
export function formatPack(pack, style = "markdown") {
  switch (style) {
    case "json":
      return formatJson(pack);
    case "xml":
      return formatXml(pack);
    case "plain":
      return formatPlain(pack);
    case "markdown":
    default:
      return formatMarkdown(pack);
  }
}

function headerMeta(pack) {
  return {
    generator: "Canopy",
    source: pack.source,
    root: pack.root,
    generatedAt: pack.generatedAt,
    fileCount: pack.files.length,
    totalBytes: pack.totalBytes,
    totalTokensEst: pack.totalTokens,
    structureOnly: !!pack.structureOnly,
    redactions: pack.redactionHits || [],
  };
}

function formatMarkdown(pack) {
  const m = headerMeta(pack);
  const lines = [];
  lines.push(`# Canopy context pack`);
  lines.push(``);
  lines.push(`Local snapshot of a codebase for an AI coding agent.`);
  lines.push(`All processing happened on this machine.`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Source | \`${m.source}\` |`);
  lines.push(`| Files | ${m.fileCount} |`);
  lines.push(`| Size | ${formatBytes(m.totalBytes)} |`);
  lines.push(`| Tokens (est.) | ${formatTokens(m.totalTokensEst)} (${m.totalTokensEst}) |`);
  lines.push(`| Generated | ${m.generatedAt} |`);
  if (m.structureOnly) lines.push(`| Mode | structure-only |`);
  if (m.redactions.length) lines.push(`| Redactions | ${m.redactions.join(", ")} |`);
  lines.push(``);
  lines.push(`## Directory tree`);
  lines.push(``);
  lines.push("```");
  lines.push(pack.tree);
  lines.push("```");
  lines.push(``);
  lines.push(`## Files`);
  lines.push(``);

  for (const f of pack.files) {
    const lang = fenceLang(f.rel);
    lines.push(`### \`${f.rel}\``);
    lines.push(``);
    lines.push(`<!-- tokens≈${f.tokens} size=${formatBytes(f.size)} -->`);
    lines.push(``);
    lines.push("```" + lang);
    lines.push(f.content.replace(/\n$/, ""));
    lines.push("```");
    lines.push(``);
  }

  if (pack.skippedFiles?.length) {
    lines.push(`## Skipped`);
    lines.push(``);
    for (const s of pack.skippedFiles.slice(0, 40)) {
      lines.push(`- \`${s.rel}\`: ${s.skipped}`);
    }
    if (pack.skippedFiles.length > 40) {
      lines.push(`- … +${pack.skippedFiles.length - 40} more`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function formatPlain(pack) {
  const m = headerMeta(pack);
  const lines = [];
  lines.push(`CANOPY CONTEXT PACK`);
  lines.push(`source: ${m.source}`);
  lines.push(`files: ${m.fileCount}`);
  lines.push(`bytes: ${m.totalBytes}`);
  lines.push(`tokens_est: ${m.totalTokensEst}`);
  lines.push(`generated: ${m.generatedAt}`);
  lines.push(``);
  lines.push(`===== DIRECTORY TREE =====`);
  lines.push(pack.tree);
  lines.push(``);
  lines.push(`===== FILES =====`);
  for (const f of pack.files) {
    lines.push(``);
    lines.push(`----- FILE: ${f.rel} -----`);
    lines.push(f.content.replace(/\n$/, ""));
    lines.push(`----- END FILE -----`);
  }
  return lines.join("\n") + "\n";
}

function formatXml(pack) {
  const m = headerMeta(pack);
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<canopy_pack>`);
  parts.push(`  <summary>`);
  parts.push(`    <source>${esc(m.source)}</source>`);
  parts.push(`    <files>${m.fileCount}</files>`);
  parts.push(`    <bytes>${m.totalBytes}</bytes>`);
  parts.push(`    <tokens_est>${m.totalTokensEst}</tokens_est>`);
  parts.push(`    <generated>${esc(m.generatedAt)}</generated>`);
  parts.push(`  </summary>`);
  parts.push(`  <directory_tree><![CDATA[`);
  parts.push(pack.tree);
  parts.push(`]]></directory_tree>`);
  parts.push(`  <files>`);
  for (const f of pack.files) {
    parts.push(`    <file path="${esc(f.rel)}" tokens="${f.tokens}">`);
    parts.push(`<![CDATA[${f.content}]]>`);
    parts.push(`    </file>`);
  }
  parts.push(`  </files>`);
  parts.push(`</canopy_pack>`);
  return parts.join("\n") + "\n";
}

function formatJson(pack) {
  const m = headerMeta(pack);
  const obj = {
    ...m,
    tree: pack.tree,
    files: Object.fromEntries(pack.files.map((f) => [f.rel, f.content])),
    skipped: (pack.skippedFiles || []).map((s) => ({ path: s.rel, reason: s.skipped })),
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

function fenceLang(rel) {
  const ext = rel.includes(".") ? rel.split(".").pop().toLowerCase() : "";
  const map = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    md: "markdown",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    sh: "bash",
    bash: "bash",
    css: "css",
    html: "html",
    sql: "sql",
    toml: "toml",
  };
  return map[ext] || ext || "";
}

/** Attach token counts to files and total. */
export function withTokenCounts(files) {
  let total = 0;
  const out = files.map((f) => {
    const tokens = estimateTokens(f.content);
    total += tokens;
    return { ...f, tokens };
  });
  return { files: out, totalTokens: total };
}
