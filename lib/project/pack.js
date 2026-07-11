import { DEFAULT_IGNORE, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_TOTAL_BYTES } from "./defaults.js";
import { formatPack, withTokenCounts } from "./format.js";
import { scrubSecrets } from "./scrub.js";
import { structureOnly } from "./structure.js";
import { formatBytes, renderTree, walkTree } from "./walk.js";

/**
 * Pack a local directory into agent context.
 *
 * @param {string} root
 * @param {object} [opts]
 * @param {string} [opts.source] display label
 * @param {string[]} [opts.ignore]
 * @param {string[]} [opts.include]
 * @param {boolean} [opts.structureOnly]
 * @param {boolean} [opts.noScrub]
 * @param {boolean} [opts.includeGitignored]
 * @param {number} [opts.maxFileBytes]
 * @param {number} [opts.maxTotalBytes]
 * @param {"markdown"|"plain"|"json"|"xml"} [opts.style]
 */
export async function packDirectory(root, opts = {}) {
  const walked = await walkTree(root, {
    defaultIgnore: DEFAULT_IGNORE,
    extraIgnore: opts.ignore || [],
    include: opts.include,
    maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    includeGitignored: opts.includeGitignored,
  });

  const maxTotal = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const redactionHits = new Set();
  /** @type {{ rel: string, size: number, content: string }[]} */
  const packed = [];
  let used = 0;

  // Prefer smaller / shallower files first when trimming
  const ordered = [...walked.files].sort((a, b) => {
    const da = a.rel.split("/").length;
    const db = b.rel.split("/").length;
    if (da !== db) return da - db;
    return a.size - b.size;
  });

  for (const f of ordered) {
    let content = f.text || "";
    if (opts.structureOnly) {
      content = structureOnly(f.rel, content);
    }
    if (!opts.noScrub) {
      const scrubbed = scrubSecrets(content);
      content = scrubbed.text;
      scrubbed.hits.forEach((h) => redactionHits.add(h));
    }

    const size = Buffer.byteLength(content, "utf8");
    if (used + size > maxTotal) {
      walked.skippedFiles.push({
        rel: f.rel,
        abs: f.abs,
        size: f.size,
        bytes: Buffer.alloc(0),
        text: null,
        skipped: "total-budget",
      });
      continue;
    }
    used += size;
    packed.push({ rel: f.rel, size, content });
  }

  const { files, totalTokens } = withTokenCounts(packed);
  const tree = renderTree(walked.treePaths.filter((p) => {
    // show tree entries that we kept or are dirs leading to kept files
    if (p.endsWith("/")) return true;
    return files.some((f) => f.rel === p) || walked.skippedFiles.some((s) => s.rel === p);
  }));

  const pack = {
    source: opts.source || root,
    root: walked.root,
    generatedAt: new Date().toISOString(),
    tree,
    files,
    skippedFiles: walked.skippedFiles,
    totalBytes: used,
    totalTokens,
    structureOnly: !!opts.structureOnly,
    redactionHits: [...redactionHits],
  };

  const text = formatPack(pack, opts.style || "markdown");
  return { pack, text, stats: summarize(pack) };
}

function summarize(pack) {
  return {
    files: pack.files.length,
    skipped: pack.skippedFiles?.length || 0,
    bytes: pack.totalBytes,
    bytesLabel: formatBytes(pack.totalBytes),
    tokens: pack.totalTokens,
    redactions: pack.redactionHits || [],
  };
}
