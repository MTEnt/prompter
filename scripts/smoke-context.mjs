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
  await fs.writeFile(path.join(dir, "src", "auth.js"), "export const login = () => {}\n");

  const meta = await attachProject(dir);
  assert.ok(meta.id);
  assert.ok(meta.fileCount >= 2);
  const req = requireProject(meta.id);
  assert.equal(req.ok, true);
  const files = req.project.files.map((f) => f.rel);
  assert.ok(!files.some((f) => f.includes(".env")), ".env must not pack");

  const slice = buildContextForQuery(req.project, "fix login auth session");
  assert.ok(slice.usedFiles.length >= 1);
  assert.ok(slice.evidence?.length >= 1);
  assert.ok(slice.promptTokens > 0);

  await fs.rm(dir, { recursive: true, force: true });
  console.log("smoke-context: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
