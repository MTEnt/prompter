import fs from "node:fs/promises";
import path from "node:path";
import { BINARY_EXTENSIONS, DEFAULT_MAX_FILE_BYTES } from "./defaults.js";
import { compileMany, loadGitignoreFiles, pathMatchesIgnore } from "./gitignore.js";

/**
 * @typedef {{ rel: string, abs: string, size: number, bytes: Buffer, text: string | null, skipped?: string }} FileEntry
 */

/**
 * @param {string} root
 * @param {object} opts
 * @param {string[]} [opts.extraIgnore]
 * @param {string[]} [opts.include]
 * @param {number} [opts.maxFileBytes]
 * @param {boolean} [opts.includeGitignored]
 * @param {string[]} [opts.defaultIgnore]
 */
export async function walkTree(root, opts = {}) {
  const absRoot = path.resolve(root);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const defaultIgnore = opts.defaultIgnore ?? [];
  const gitLines = opts.includeGitignored ? [] : await loadGitignoreFiles(absRoot, fs);
  const rules = compileMany([...defaultIgnore, ...gitLines, ...(opts.extraIgnore || [])]);
  const includeRules = opts.include?.length
    ? compileMany(opts.include.map((p) => (p.includes("/") || p.includes("*") ? p : `**/${p}`)))
    : null;

  /** @type {FileEntry[]} */
  const files = [];
  /** @type {string[]} */
  const treePaths = [];
  let totalBytes = 0;
  let skipped = 0;

  async function visit(dirAbs, relDir) {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(dirAbs, ent.name);

      if (pathMatchesIgnore(rel, ent.isDirectory(), rules)) {
        skipped++;
        continue;
      }

      if (ent.isDirectory()) {
        treePaths.push(rel + "/");
        await visit(abs, rel);
        continue;
      }

      if (!ent.isFile()) continue;

      if (includeRules) {
        const ok = includeRules.some((r) => r && r.re.test(rel.replace(/\\/g, "/")));
        if (!ok) {
          skipped++;
          continue;
        }
      }

      treePaths.push(rel);

      const ext = path.extname(ent.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        files.push({
          rel,
          abs,
          size: 0,
          bytes: Buffer.alloc(0),
          text: null,
          skipped: "binary-extension",
        });
        skipped++;
        continue;
      }

      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }

      if (st.size > maxFileBytes) {
        files.push({
          rel,
          abs,
          size: st.size,
          bytes: Buffer.alloc(0),
          text: null,
          skipped: `too-large (${formatBytes(st.size)} > ${formatBytes(maxFileBytes)})`,
        });
        skipped++;
        continue;
      }

      let buf;
      try {
        buf = await fs.readFile(abs);
      } catch {
        continue;
      }

      if (looksBinary(buf)) {
        files.push({
          rel,
          abs,
          size: buf.length,
          bytes: Buffer.alloc(0),
          text: null,
          skipped: "binary-content",
        });
        skipped++;
        continue;
      }

      const text = buf.toString("utf8");
      totalBytes += buf.length;
      files.push({ rel, abs, size: buf.length, bytes: buf, text });
    }
  }

  await visit(absRoot, "");

  return {
    root: absRoot,
    files: files.filter((f) => f.text != null),
    skippedFiles: files.filter((f) => f.skipped),
    treePaths,
    totalBytes,
    skippedCount: skipped,
  };
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  let weird = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32 && b !== 9 && b !== 10 && b !== 13)) weird++;
  }
  return weird / n > 0.3;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build an ASCII directory tree from relative paths. */
export function renderTree(treePaths) {
  const root = { name: "", kids: new Map(), file: false };
  for (const p of treePaths) {
    const isDir = p.endsWith("/");
    const parts = (isDir ? p.slice(0, -1) : p).split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const last = i === parts.length - 1;
      if (!node.kids.has(name)) {
        node.kids.set(name, { name, kids: new Map(), file: last && !isDir });
      }
      node = node.kids.get(name);
      if (last && isDir) node.file = false;
    }
  }

  const lines = ["."];
  function walk(node, prefix) {
    const entries = [...node.kids.values()].sort((a, b) => {
      const ad = a.kids.size > 0 && !a.file;
      const bd = b.kids.size > 0 && !b.file;
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    entries.forEach((child, idx) => {
      const last = idx === entries.length - 1;
      const branch = last ? "└── " : "├── ";
      const dir = child.kids.size > 0 && !child.file;
      lines.push(prefix + branch + child.name + (dir ? "/" : ""));
      if (dir) {
        walk(child, prefix + (last ? "    " : "│   "));
      }
    });
  }
  walk(root, "");
  return lines.join("\n");
}
