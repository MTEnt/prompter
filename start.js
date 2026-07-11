#!/usr/bin/env node
/**
 * Braindead launcher: start Prompter and open the browser.
 * Used by Start Prompter.command / .sh / .bat
 */

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

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

async function main() {
  process.chdir(__dirname);

  if (await alreadyUp()) {
    console.log(`\n  Prompter is already running.\n  → ${URL}\n`);
    openBrowser(URL);
    // Keep window open briefly on double-click shells
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  console.log(`\n  Starting Prompter…\n  → ${URL}\n  Leave this window open. Close it to stop the app.\n`);

  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    stdio: "inherit",
    env: process.env,
  });

  // Give server a moment, then open browser
  setTimeout(() => openBrowser(URL), 700);

  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    console.error("\n  Could not start Prompter:", err.message);
    console.error("  Make sure Node.js is installed: https://nodejs.org\n");
    process.exit(1);
  });
}

main();
