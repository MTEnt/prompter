/**
 * Retrieval evaluation harness for Prompter.
 *
 * Measures file/symbol recall on labeled fixture tasks.
 * Run: node scripts/eval-retrieval.mjs
 *
 * Exit 1 if file recall@5 or symbol recall falls below thresholds.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachProject, buildContextForQuery, requireProject } from "../lib/project/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "eval/fixtures/billing-app");
const TASKS = path.join(ROOT, "eval/tasks.json");

const THRESHOLDS = {
  minFileRecall: 0.55,
  minSymbolRecall: 0.5,
  minEasyFileRecall: 0.85,
};

function norm(p) {
  return String(p || "").replace(/\\/g, "/");
}

function fileHit(usedFiles, mustFile) {
  const m = norm(mustFile);
  return usedFiles.some((u) => {
    const x = norm(u);
    return x === m || x.endsWith("/" + m) || x.includes(m);
  });
}

function symbolHit(evidence, text, mustSym) {
  const name = mustSym.toLowerCase();
  if (evidence.some((e) => String(e.symbol || e.path || "").toLowerCase().includes(name))) {
    return true;
  }
  return text.toLowerCase().includes(name);
}

async function main() {
  const tasks = JSON.parse(await fs.readFile(TASKS, "utf8"));
  const meta = await attachProject(FIXTURE);
  const { project } = requireProject(meta.id);
  if (!project) throw new Error("attach failed");

  console.log(`eval fixture: ${FIXTURE}`);
  console.log(
    `indexed files=${meta.fileCount} symbols=${meta.symbolCount} engine=${meta.symbolEngine}`
  );
  console.log("");

  let fileHits = 0;
  let fileNeed = 0;
  let symHits = 0;
  let symNeed = 0;
  let easyFileHits = 0;
  let easyFileNeed = 0;
  const rows = [];

  for (const t of tasks) {
    const slice = buildContextForQuery(project, t.query, { maxChars: 16000 });
    const used = slice.usedFiles || [];
    const evidence = slice.evidence || [];
    const text = slice.text || "";

    const mustFiles = t.must_files || [];
    const mustSyms = t.must_symbols || [];
    let tf = 0;
    for (const f of mustFiles) {
      fileNeed++;
      if (fileHit(used, f)) {
        fileHits++;
        tf++;
      }
      if (t.kind === "exact-symbol") {
        easyFileNeed++;
        if (fileHit(used, f)) easyFileHits++;
      }
    }
    let ts = 0;
    for (const s of mustSyms) {
      symNeed++;
      if (symbolHit(evidence, text, s)) {
        symHits++;
        ts++;
      }
    }

    const fr = mustFiles.length ? tf / mustFiles.length : 1;
    const sr = mustSyms.length ? ts / mustSyms.length : 1;
    rows.push({
      id: t.id,
      kind: t.kind,
      mode: slice.mode,
      fileRecall: fr,
      symbolRecall: sr,
      used: used.length,
      expanded: slice.report?.expanded?.length || 0,
    });

    const mark = fr >= 1 && sr >= 1 ? "OK " : fr >= 0.5 ? "~~ " : "FAIL";
    console.log(
      `${mark} ${t.id.padEnd(32)} file=${(fr * 100).toFixed(0).padStart(3)}% sym=${(sr * 100)
        .toFixed(0)
        .padStart(3)}% mode=${slice.mode} used=${used.length}`
    );
    if (fr < 1 || sr < 1) {
      console.log(`     used: ${used.join(", ") || "(none)"}`);
      if (mustFiles.length) console.log(`     need files: ${mustFiles.join(", ")}`);
      if (mustSyms.length) console.log(`     need symbols: ${mustSyms.join(", ")}`);
    }
  }

  const fileRecall = fileNeed ? fileHits / fileNeed : 1;
  const symbolRecall = symNeed ? symHits / symNeed : 1;
  const easyFileRecall = easyFileNeed ? easyFileHits / easyFileNeed : 1;

  console.log("");
  console.log("── aggregates ──");
  console.log(`file recall (all must_files):   ${(fileRecall * 100).toFixed(1)}%  (need ≥ ${(THRESHOLDS.minFileRecall * 100).toFixed(0)}%)`);
  console.log(`symbol recall (all must_symbols): ${(symbolRecall * 100).toFixed(1)}%  (need ≥ ${(THRESHOLDS.minSymbolRecall * 100).toFixed(0)}%)`);
  console.log(`file recall (exact-symbol only): ${(easyFileRecall * 100).toFixed(1)}%  (need ≥ ${(THRESHOLDS.minEasyFileRecall * 100).toFixed(0)}%)`);

  const pass =
    fileRecall >= THRESHOLDS.minFileRecall &&
    symbolRecall >= THRESHOLDS.minSymbolRecall &&
    easyFileRecall >= THRESHOLDS.minEasyFileRecall;

  console.log(pass ? "\nRESULT: PASS" : "\nRESULT: FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
