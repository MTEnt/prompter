/**
 * Minimal offline smoke tests for project context helpers.
 * Run: node scripts/smoke-context.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { attachProject, buildContextForQuery, requireProject } from "../lib/project/context.js";
import { isForbiddenAttachRoot, isSecurityDenied } from "../lib/project/security-path.js";
import { scrubSecrets } from "../lib/project/scrub.js";

async function main() {
  assert.equal(isSecurityDenied(".env", false), true);
  assert.equal(isSecurityDenied("src/app.js", false), false);
  assert.equal(isForbiddenAttachRoot("/etc"), true);

  const scrubbed = scrubSecrets('const k = "sk-ant-abcdefghijklmnopqrstuvwxyz";');
  assert.match(scrubbed.text, /REDACTED/);

  const base = path.join(os.homedir(), ".prompter-smoke-tmp");
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, "t-"));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "smoke" }));
  await fs.writeFile(path.join(dir, "index.js"), "export function hello() { return 1 }\n");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=nope\n");
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(
    path.join(dir, "src", "auth.js"),
    `
export function login(user, password) {
  return { user, ok: true };
}
export class Session {
  constructor(id) { this.id = id; }
  validate() { return Boolean(this.id); }
}
export async function loadUser(id) {
  return { id, name: "test" };
}
`
  );

  const meta = await attachProject(dir);
  assert.ok(meta.id);
  assert.ok(meta.fileCount >= 2);
  assert.ok(meta.symbolCount >= 2, `expected symbols, got ${meta.symbolCount}`);
  assert.equal(meta.symbolEngine, "tree-sitter");
  const req = requireProject(meta.id);
  assert.equal(req.ok, true);
  const files = req.project.files.map((f) => f.rel);
  assert.ok(!files.some((f) => f.includes(".env")), ".env must not pack");

  // Lightweight index: no full bodies resident
  assert.ok(req.project.files.every((f) => f.content == null), "index must not keep full bodies");
  assert.ok(req.project.files.every((f) => f.abs), "index files need abs for lazy load");

  const slice = await buildContextForQuery(req.project, "fix login auth session validate");
  assert.ok(slice.usedFiles.length >= 1);
  assert.ok(slice.evidence?.length >= 1);
  assert.ok(slice.promptTokens > 0);
  assert.ok(slice.bodiesLoaded >= 1, "should lazy-load selected bodies");
  assert.ok(
    /login|Session|loadUser|symbol|lazy/i.test(slice.text),
    "expected symbol-aware context text"
  );
  assert.match(slice.text, /lazy|symbol|Direct/i);

  await fs.rm(dir, { recursive: true, force: true });
  console.log("smoke-context: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
