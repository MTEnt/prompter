#!/usr/bin/env node
/**
 * One-click launcher for Prompter.
 * - Checks Node
 * - Installs npm dependencies if missing (tree-sitter, etc.)
 * - Starts the local server
 * - Opens the browser
 *
 * Used by: Start Prompter.command / .bat / start-prompter.sh / npm start
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

const REQUIRED_MODULES = ["web-tree-sitter", "@vscode/tree-sitter-wasm"];

function log(msg = "") {
  console.log(msg);
}

function alreadyUp() {
  return new Promise((resolve) => {
    const req = http.get(URL + "/api/health", (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowser(url) {
  const plat = process.platform;
  try {
    if (plat === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (plat === "win32")
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* ignore */
  }
}

function modulePath(name) {
  return path.join(__dirname, "node_modules", ...name.split("/"));
}

function needsInstall() {
  for (const name of REQUIRED_MODULES) {
    if (!fs.existsSync(modulePath(name))) return true;
  }
  // package.json newer than node_modules marker → reinstall
  try {
    const pkg = fs.statSync(path.join(__dirname, "package.json")).mtimeMs;
    const nm = fs.statSync(path.join(__dirname, "node_modules")).mtimeMs;
    if (pkg > nm + 1000) return true;
  } catch {
    return true;
  }
  return false;
}

function findNpm() {
  const candidates =
    process.platform === "win32"
      ? ["npm.cmd", "npm"]
      : ["npm"];
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (r.status === 0) return c;
  }
  return null;
}

function ensureDependencies() {
  if (!needsInstall()) {
    log("  Dependencies: ready");
    return true;
  }

  log("");
  log("  First-time setup: installing dependencies…");
  log("  (tree-sitter grammars for reading your code. Needs internet once.)");
  log("");

  const npm = findNpm();
  if (!npm) {
    log("  Could not find npm (it usually comes with Node.js).");
    log("  Reinstall Node LTS from https://nodejs.org and try again.");
    return false;
  }

  const r = spawnSync(npm, ["install", "--no-fund", "--no-audit"], {
    cwd: __dirname,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });

  if (r.status !== 0) {
    log("");
    log("  npm install failed.");
    log("  Check your internet connection, then double-click Start Prompter again.");
    return false;
  }

  // Verify required modules landed
  for (const name of REQUIRED_MODULES) {
    if (!fs.existsSync(modulePath(name))) {
      log(`  Install finished but missing: ${name}`);
      return false;
    }
  }

  log("");
  log("  Dependencies: installed");
  return true;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    log(`  Node.js ${process.versions.node} is too old. Need 18+ (LTS).`);
    log("  Get it from https://nodejs.org");
    return false;
  }
  return true;
}

async function waitForHealth(maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await alreadyUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  process.chdir(__dirname);

  log("");
  log("  Prompter");
  log("  --------");
  log(`  Node ${process.versions.node}`);
  log("");

  if (!checkNodeVersion()) process.exit(1);

  if (await alreadyUp()) {
    log(`  Already running.`);
    log(`  → ${URL}`);
    log("");
    openBrowser(URL);
    setTimeout(() => process.exit(0), 1200);
    return;
  }

  if (!ensureDependencies()) process.exit(1);

  log(`  Starting…`);
  log(`  → ${URL}`);
  log("  Leave this window open. Close it to stop.");
  log("");

  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (err) => {
    log("");
    log("  Could not start Prompter: " + err.message);
    log("  Make sure Node.js is installed: https://nodejs.org");
    log("");
    process.exit(1);
  });

  // Open browser once health is up (or after short wait)
  const ok = await waitForHealth(12000);
  openBrowser(URL);
  if (!ok) {
    log("  Browser opened; if the page is blank, wait a second and refresh.");
  }

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
