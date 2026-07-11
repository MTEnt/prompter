/**
 * Detect and invoke local AI coding agents (Grok, Codex, Claude, Gemini, agy, …).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ordered preference when --agent auto
 * (Grok first on this machine since user is on Grok Build frequently)
 */
export const AGENT_ORDER = ["grok", "codex", "claude", "gemini", "agy", "agent"];

/**
 * @typedef {object} AgentDef
 * @property {string} id
 * @property {string} name
 * @property {string[]} bins - candidate binary names
 * @property {(prompt: string, opts: RunOpts) => {cmd: string, args: string[], env?: object}} build
 * @property {string} notes
 */

/** @typedef {{ cwd?: string, headless?: boolean, yes?: boolean, model?: string }} RunOpts */

/** @type {Record<string, AgentDef>} */
export const AGENTS = {
  grok: {
    id: "grok",
    name: "Grok Build",
    bins: ["grok"],
    notes: "xAI Grok Build TUI/CLI",
    build(prompt, opts) {
      const args = [];
      if (opts.cwd) args.push("--cwd", opts.cwd);
      if (opts.model) args.push("-m", opts.model);
      if (opts.headless) {
        // single-turn print & exit
        args.push("-p", prompt);
        if (opts.yes) args.push("--always-approve");
      } else {
        // interactive session with initial prompt
        if (opts.yes) args.push("--always-approve");
        args.push(prompt);
      }
      return { cmd: "grok", args };
    },
  },
  agent: {
    id: "agent",
    name: "Grok Build (agent)",
    bins: ["agent"],
    notes: "Alias binary for Grok Build on some installs",
    build(prompt, opts) {
      // Same CLI as grok
      const g = AGENTS.grok.build(prompt, opts);
      return { cmd: "agent", args: g.args };
    },
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    bins: ["codex"],
    notes: "OpenAI Codex CLI — exec for headless",
    build(prompt, opts) {
      if (opts.headless) {
        const args = ["exec"];
        if (opts.model) args.push("-m", opts.model);
        if (opts.yes) {
          // full-auto style if supported via config override
          args.push("-c", "approval_policy=never");
        }
        args.push(prompt);
        return { cmd: "codex", args };
      }
      // interactive TUI with initial prompt
      const args = [];
      if (opts.model) args.push("-m", opts.model);
      args.push(prompt);
      return { cmd: "codex", args };
    },
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    bins: ["claude"],
    notes: "Anthropic Claude Code — -p for headless",
    build(prompt, opts) {
      const args = [];
      if (opts.model) args.push("--model", opts.model);
      if (opts.headless) {
        args.push("-p", prompt);
        if (opts.yes) args.push("--dangerously-skip-permissions");
      } else {
        // interactive with prompt as initial message
        if (opts.yes) args.push("--dangerously-skip-permissions");
        args.push(prompt);
      }
      return { cmd: "claude", args };
    },
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    bins: ["gemini"],
    notes: "Google Gemini CLI — -p for headless",
    build(prompt, opts) {
      const args = [];
      if (opts.model) args.push("-m", opts.model);
      if (opts.headless) {
        args.push("-p", prompt);
        if (opts.yes) args.push("-y");
      } else {
        // interactive: query as positionals
        if (opts.yes) args.push("-y");
        args.push(prompt);
      }
      return { cmd: "gemini", args };
    },
  },
  agy: {
    id: "agy",
    name: "agy",
    bins: ["agy"],
    notes: "agy CLI — --print / -p for headless",
    build(prompt, opts) {
      const args = [];
      if (opts.model) args.push("--model", opts.model);
      if (opts.headless) {
        args.push("--print", prompt);
        if (opts.yes) args.push("--dangerously-skip-permissions");
      } else {
        if (opts.yes) args.push("--dangerously-skip-permissions");
        // interactive initial prompt
        args.push("--prompt-interactive", prompt);
      }
      return { cmd: "agy", args };
    },
  },
};

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  // also check common paths
  const homes = [
    path.join(os.homedir(), ".grok", "bin", bin),
    path.join(os.homedir(), ".local", "bin", bin),
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
  ];
  for (const p of homes) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @returns {Array<{id: string, name: string, path: string, notes: string, available: boolean}>}
 */
export function detectAgents() {
  const seen = new Set();
  const out = [];
  for (const id of AGENT_ORDER) {
    const def = AGENTS[id];
    if (!def) continue;
    let found = null;
    for (const b of def.bins) {
      found = which(b);
      if (found) break;
    }
    // de-dupe grok/agent if same install family — still list both if both bins exist
    out.push({
      id: def.id,
      name: def.name,
      path: found,
      notes: def.notes,
      available: Boolean(found),
    });
    if (found) seen.add(found);
  }
  return out;
}

export function pickAgent(preferred = "auto") {
  const detected = detectAgents();
  if (preferred && preferred !== "auto") {
    const hit = detected.find((a) => a.id === preferred && a.available);
    if (!hit) {
      return {
        ok: false,
        error: `Agent "${preferred}" not found on PATH. Run: prompter agents`,
        detected,
      };
    }
    return { ok: true, agent: hit, detected };
  }
  const first = detected.find((a) => a.available);
  if (!first) {
    return {
      ok: false,
      error:
        "No AI coding CLI detected. Install one of: grok, codex, claude, gemini, agy",
      detected,
    };
  }
  return { ok: true, agent: first, detected };
}

/**
 * Write prompt to a temp file (avoids shell length limits / quoting hell).
 */
export function writePromptFile(prompt, prefix = "prompter-run") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const file = path.join(dir, "prompt.md");
  fs.writeFileSync(file, prompt, "utf8");
  return file;
}

/**
 * Run an agent with a prompt. Interactive uses inherit stdio.
 * @returns {Promise<{ok: boolean, code: number|null, agent: string, cmd: string, args: string[]}>}
 */
export function runAgent(agentId, prompt, opts = {}) {
  const pick = pickAgent(agentId || "auto");
  if (!pick.ok) {
    return Promise.resolve({ ok: false, error: pick.error, code: 1, detected: pick.detected });
  }

  const def = AGENTS[pick.agent.id];
  const headless = opts.headless !== false ? opts.headless === true : false;
  // default: interactive (agent does real work with user present)
  const runOpts = {
    cwd: opts.cwd || process.cwd(),
    headless: Boolean(opts.headless),
    yes: Boolean(opts.yes),
    model: opts.model,
  };

  const built = def.build(prompt, runOpts);
  const binPath = pick.agent.path || built.cmd;

  // Prefer prompt-file when available for long prompts (grok)
  let args = built.args;
  if (
    (pick.agent.id === "grok" || pick.agent.id === "agent") &&
    runOpts.headless &&
    prompt.length > 4000
  ) {
    const file = writePromptFile(prompt);
    args = [];
    if (runOpts.cwd) args.push("--cwd", runOpts.cwd);
    if (runOpts.model) args.push("-m", runOpts.model);
    if (runOpts.yes) args.push("--always-approve");
    args.push("--prompt-file", file);
  }

  console.error(`→ Running ${pick.agent.name} (${pick.agent.id})`);
  console.error(`  $ ${built.cmd} ${summarizeArgs(args)}`);
  if (runOpts.headless) console.error("  mode: headless");
  else console.error("  mode: interactive (complete the session in the agent UI)");

  return new Promise((resolve) => {
    const child = spawn(binPath, args, {
      cwd: runOpts.cwd,
      stdio: "inherit",
      env: { ...process.env, ...(built.env || {}) },
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        error: err.message,
        code: 1,
        agent: pick.agent.id,
        cmd: built.cmd,
        args,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        agent: pick.agent.id,
        name: pick.agent.name,
        cmd: built.cmd,
        args,
      });
    });
  });
}

function summarizeArgs(args) {
  return args
    .map((a) => {
      if (a.length > 60 && !a.startsWith("-")) return `"${a.slice(0, 40)}…"`;
      if (/\s/.test(a)) return JSON.stringify(a);
      return a;
    })
    .join(" ");
}

export function formatAgentsTable(detected) {
  const lines = ["id".padEnd(10) + "status".padEnd(12) + "name".padEnd(18) + "path"];
  for (const a of detected) {
    lines.push(
      a.id.padEnd(10) +
        (a.available ? "ready".padEnd(12) : "missing".padEnd(12)) +
        a.name.padEnd(18) +
        (a.path || "—")
    );
  }
  return lines.join("\n");
}

/**
 * Build argv for an agent without running it (for UI + Terminal launch).
 */
export function buildAgentInvocation(agentId, prompt, opts = {}) {
  const pick = pickAgent(agentId || "auto");
  if (!pick.ok) return pick;
  const def = AGENTS[pick.agent.id];
  const runOpts = {
    cwd: opts.cwd || process.cwd(),
    headless: Boolean(opts.headless),
    yes: Boolean(opts.yes),
    model: opts.model,
  };
  const built = def.build(prompt, runOpts);
  const bin = pick.agent.path || built.cmd;

  // Prefer prompt-file for long prompts with grok headless
  let args = built.args;
  let promptFile = null;
  if (
    (pick.agent.id === "grok" || pick.agent.id === "agent") &&
    (runOpts.headless || prompt.length > 2000)
  ) {
    promptFile = writePromptFile(prompt);
    args = [];
    if (runOpts.cwd) args.push("--cwd", runOpts.cwd);
    if (runOpts.model) args.push("-m", runOpts.model);
    if (runOpts.yes) args.push("--always-approve");
    if (runOpts.headless) {
      args.push("--prompt-file", promptFile);
    } else {
      // interactive but large prompt via file if supported — fall back to prompt arg
      args.push("--prompt-file", promptFile);
    }
  } else if (prompt.length > 8000) {
    // Write to file and tell agent via a short pointer for CLIs without --prompt-file
    promptFile = writePromptFile(prompt);
    // Keep original args but replace last long prompt with instruction to read file
    const short = `Read the full task from this file and execute it completely:\n${promptFile}`;
    args = def.build(short, runOpts).args;
  }

  const shell = shellEscape([bin, ...args]);
  return {
    ok: true,
    agent: pick.agent,
    cmd: built.cmd,
    bin,
    args,
    shell,
    cwd: runOpts.cwd,
    promptFile,
    headless: runOpts.headless,
  };
}

function shellEscape(parts) {
  return parts
    .map((p) => {
      if (p == null) return "";
      const s = String(p);
      if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(s)) return s;
      return `'${s.replace(/'/g, `'\\''`)}'`;
    })
    .join(" ");
}

/**
 * Open macOS Terminal (or run headless spawn) with the agent command.
 */
export async function launchAgentInTerminal(agentId, prompt, opts = {}) {
  const inv = buildAgentInvocation(agentId, prompt, { ...opts, headless: false });
  if (!inv.ok) return inv;

  const cwd = inv.cwd || process.cwd();
  const full = `cd ${shellEscape([cwd])} && ${inv.shell}`;

  if (process.platform === "darwin") {
    // Open Terminal.app with the command
    const script = `tell application "Terminal"
  activate
  do script ${JSON.stringify(full)}
end tell`;
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
      child.on("error", (err) =>
        resolve({ ok: false, error: err.message, invocation: inv })
      );
      child.on("close", (code) =>
        resolve({
          ok: code === 0,
          code,
          launched: "terminal",
          agent: inv.agent,
          shell: inv.shell,
          cwd,
          invocation: inv,
        })
      );
    });
  }

  // Non-macOS: spawn detached interactive in background is hard — fall back to spawn inherit
  // When called from HTTP server, inherit won't attach to user TTY; use headless instead
  if (opts.forceSpawn || opts.headless) {
    return runAgent(agentId, prompt, { ...opts, headless: true });
  }

  return {
    ok: true,
    launched: "command",
    agent: inv.agent,
    shell: inv.shell,
    cwd,
    message: `Run this in your terminal:\n  ${full}`,
    invocation: inv,
  };
}
