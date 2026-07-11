#!/usr/bin/env node
/**
 * Prompter CLI: library + improve + export for any AI tool.
 *
 * Usage:
 *   prompter serve
 *   prompter list [--tag x] [--category y] [--target codex] [--query q]
 *   prompter show <id>
 *   prompter use <id> [--var name=value ...] [--target codex] [--copy] [--improve] [--strength medium]
 *   prompter improve [--target codex] [--task coding] [--strength medium] [--llm] [file|-]
 *   prompter pipe [--target codex] ...   # stdin → improve → stdout
 *   prompter export <id> --tool skill|agents_md|codex|claude|... [--var k=v]
 *   prompter patterns
 *   prompter tools
 *   prompter doctor
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  loadTemplates,
  loadPatterns,
  getTemplate,
  searchTemplates,
  renderTemplate,
  exportForTool,
  libraryIndex,
} from "../lib/library.js";
import { improvePromptLocal, listCatalog } from "../lib/improver.js";
import { detectLlmConfig, polishWithLlm } from "../lib/llm-polish.js";
import { listDirections } from "../lib/directions.js";
import { composeAndExport } from "../lib/compose.js";
import {
  detectAgents,
  pickAgent,
  runAgent,
  formatAgentsTable,
} from "../lib/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const TOOLS = [
  "codex",
  "claude",
  "grok",
  "gemini",
  "cursor",
  "copilot",
  "agents_md",
  "skill",
  "system",
  "clipboard",
  "generic",
];

function printHelp() {
  console.log(`Prompter: compose a good prompt, then run it on a real AI agent

Detect agents on this machine:
  prompter agents

Compose only (clipboard):
  prompter make "Add dark mode" --direction implement --target codex --copy

Compose + run the agent that does the work:
  prompter run "Add dark mode to settings" --direction implement --agent auto
  prompter run "fix the auth bug" --direction debug --agent claude
  prompter run "review src/" --direction review --agent codex --headless
  echo "polish homepage" | prompter run - --direction ui --agent grok

Flags:
  --agent auto|grok|codex|claude|gemini|agy|agent
  --direction implement|review|debug|ui|freeform|...
  --target   same as agent profile for prompt shaping (defaults to --agent)
  --headless run non-interactive single-shot (where supported)
  --yes      auto-approve tools (dangerous; only if you trust the task)
  --cwd DIR  working directory for the agent
  --model M  model override when the agent supports it
  --copy     also copy the composed prompt
  --print-only  only print the composed prompt (don't launch agent)

Other: serve | directions | list | doctor | help
`);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        if (key === "var") {
          args.flags.var = args.flags.var || [];
          args.flags.var.push(next);
          i++;
        } else {
          args.flags[key] = next;
          i++;
        }
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function parseVars(list = []) {
  const out = {};
  for (const item of list) {
    const idx = item.indexOf("=");
    if (idx === -1) continue;
    out[item.slice(0, idx)] = item.slice(idx + 1);
  }
  return out;
}

async function copyToClipboard(text) {
  const platform = process.platform;
  let cmd;
  let args = [];
  if (platform === "darwin") cmd = "pbcopy";
  else if (platform === "win32") {
    cmd = "clip";
  } else {
    cmd = "wl-copy";
    // fallback xclip
  }
  return new Promise((resolve) => {
    const trySpawn = (c, a = []) => {
      try {
        const p = spawn(c, a, { stdio: ["pipe", "ignore", "ignore"] });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
        p.stdin.write(text);
        p.stdin.end();
      } catch {
        resolve(false);
      }
    };
    if (platform === "linux") {
      const p = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
      p.on("error", () => {
        const p2 = spawn("xclip", ["-selection", "clipboard"], {
          stdio: ["pipe", "ignore", "ignore"],
        });
        p2.on("error", () => resolve(false));
        p2.on("close", (code) => resolve(code === 0));
        p2.stdin.write(text);
        p2.stdin.end();
      });
      p.on("close", (code) => {
        if (code === 0) resolve(true);
      });
      p.stdin.write(text);
      p.stdin.end();
      return;
    }
    trySpawn(cmd, args);
  });
}

async function maybeCopyAndOut(text, flags) {
  if (flags.out) {
    fs.writeFileSync(flags.out, text.endsWith("\n") ? text : text + "\n");
    console.error(`Wrote ${flags.out}`);
  }
  if (flags.copy) {
    const ok = await copyToClipboard(text);
    console.error(ok ? "Copied to clipboard" : "Clipboard copy failed");
  }
}

async function cmdList(flags) {
  const results = searchTemplates(flags.query || "", {
    tag: flags.tag,
    category: flags.category,
    target: flags.target,
  });
  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (!results.length) {
    console.log("No templates matched.");
    return;
  }
  for (const t of results) {
    const tags = t.tags.length ? ` [${t.tags.join(", ")}]` : "";
    console.log(`${t.id.padEnd(24)} ${t.category.padEnd(10)} ${t.title}${tags}`);
  }
  console.error(`\n${results.length} template(s)`);
}

function cmdShow(id) {
  const t = getTemplate(id);
  if (!t) {
    console.error(`Unknown template: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${t.title} (${t.id})`);
  console.log(t.description);
  console.log(`category: ${t.category}`);
  console.log(`targets: ${t.targets.join(", ")}`);
  console.log(`tags: ${t.tags.join(", ")}`);
  if (t.variables.length) {
    console.log("variables:");
    for (const v of t.variables) {
      console.log(
        `  - ${v.name}${v.required ? " (required)" : ""}${v.help ? ": " + v.help : ""}`
      );
    }
  }
  console.log("\n--- body ---\n");
  console.log(t.body);
}

async function cmdUse(id, flags) {
  const t = getTemplate(id);
  if (!t) {
    console.error(`Unknown template: ${id}`);
    process.exitCode = 1;
    return;
  }
  const vars = parseVars(flags.var || []);
  const rendered = renderTemplate(t, vars);
  if (!rendered.ok) {
    console.error(rendered.error);
    process.exitCode = 1;
    return;
  }

  let text = rendered.text;
  const target = flags.target || flags.tool || "generic";

  if (flags.improve || flags.llm) {
    const local = improvePromptLocal({
      prompt: text,
      profileId: target === "agents_md" || target === "skill" ? "generic" : target,
      taskId: flags.task || t.defaultTask,
      strengthId: flags.strength || t.defaultStrength,
    });
    text = local.improved;
    if (flags.llm) {
      const polished = await polishWithLlm({
        original: rendered.text,
        localImproved: text,
        profileName: target,
        taskName: flags.task || t.defaultTask,
        strengthName: flags.strength || t.defaultStrength,
      });
      if (polished.ok) text = polished.improved;
      else console.error(`LLM polish skipped: ${polished.error}`);
    }
  }

  const tool = flags.tool || target;
  const exported = exportForTool(text, tool, {
    id: t.id,
    title: t.title,
    description: t.description,
  });

  process.stdout.write(exported.text.endsWith("\n") ? exported.text : exported.text + "\n");
  if (!flags.json) console.error(`[${tool}] ${exported.hint}`);
  await maybeCopyAndOut(exported.text, flags);
}

async function readInput(fileArg) {
  if (!fileArg || fileArg === "-") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  }
  return fs.readFileSync(fileArg, "utf8");
}

async function cmdImprove(fileArg, flags, asPipe = false) {
  const raw = (await readInput(fileArg)).trim();
  if (!raw) {
    console.error("Empty input");
    process.exitCode = 1;
    return;
  }
  const target = flags.target || "generic";
  const direction = flags.direction || "freeform";

  let result = composeAndExport({
    input: raw,
    directionId: direction,
    profileId: target,
    tool: flags.tool || target,
    extraContext: flags.context || "",
    strengthId: flags.strength || undefined,
  });
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  let text = result.text || result.improved;
  if (flags.llm) {
    const polished = await polishWithLlm({
      original: raw,
      localImproved: result.improved,
      profileName: target,
      taskName: result.meta?.task || "general",
      strengthName: result.meta?.strength || "medium",
    });
    if (polished.ok) {
      const exported = exportForTool(polished.improved, flags.tool || target, {
        title: result.meta?.directionLabel || "Prompt",
      });
      text = exported.text;
    } else if (!asPipe) console.error(`LLM polish skipped: ${polished.error}`);
  }
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  if (!asPipe) {
    console.error(
      `[${target}] ${result.meta?.directionLabel || direction}${result.meta?.templateId ? ` · template ${result.meta.templateId}` : ""}`
    );
  }
  await maybeCopyAndOut(text, flags);
}

function cmdDirections(flags) {
  const dirs = listDirections();
  if (flags.json) {
    console.log(JSON.stringify(dirs, null, 2));
    return;
  }
  for (const d of dirs) {
    console.log(`${d.id.padEnd(14)} ${d.label.padEnd(20)} ${d.blurb}`);
  }
}

function cmdPatterns(flags) {
  const patterns = loadPatterns();
  if (flags.json) {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }
  for (const p of patterns) {
    console.log(`${p.id.padEnd(22)} ${p.title}: ${p.summary}`);
  }
}

function cmdDoctor() {
  const idx = libraryIndex();
  const llm = detectLlmConfig();
  const agents = detectAgents();
  console.log("Prompter doctor");
  console.log(`  root: ${ROOT}`);
  console.log(`  templates: ${idx.count.templates}`);
  console.log(`  patterns: ${idx.count.patterns}`);
  console.log(`  directions: ${listDirections().length}`);
  console.log(
    llm.available
      ? `  llm polish: ${llm.name} (${llm.model})`
      : "  llm polish: not configured (local compose still works)"
  );
  console.log("  agents:");
  for (const a of agents) {
    console.log(`    ${a.available ? "✓" : "·"} ${a.id.padEnd(8)} ${a.available ? a.path : "not installed"}`);
  }
  const pick = pickAgent("auto");
  if (pick.ok) console.log(`  default auto → ${pick.agent.id}`);
  const sample = getTemplate("implement-feature");
  if (!sample) {
    console.error("  ERROR: implement-feature template missing");
    process.exitCode = 1;
  } else {
    const r = renderTemplate(sample, { goal: "test" });
    console.log(r.ok ? "  render: ok" : `  render: FAIL ${r.error}`);
  }
}

function cmdAgents(flags) {
  const detected = detectAgents();
  if (flags.json) {
    console.log(JSON.stringify(detected, null, 2));
    return;
  }
  console.log(formatAgentsTable(detected));
  const pick = pickAgent("auto");
  if (pick.ok) {
    console.error(`\nauto → ${pick.agent.id} (${pick.agent.name})`);
  } else {
    console.error(`\n${pick.error}`);
    process.exitCode = 1;
  }
}

/**
 * Compose a direction-aware prompt, then hand it to a real coding agent.
 */
async function cmdRun(parsed, flags) {
  let input = "";
  const arg = parsed._[0];
  if (!arg || arg === "-") {
    input = (await readInput("-")).trim();
  } else {
    input = String(arg).trim();
  }
  if (!input) {
    console.error('usage: prompter run "what you want done" --direction implement --agent auto');
    process.exitCode = 1;
    return;
  }

  const agentId = flags.agent || "auto";
  // Shape prompt for the same tool we're launching when possible
  const profile =
    flags.target ||
    (agentId !== "auto" ? agentId : undefined) ||
    pickAgent(agentId).agent?.id ||
    "generic";

  const direction = flags.direction || "freeform";
  const composed = composeAndExport({
    input,
    directionId: direction,
    profileId: profile === "agent" ? "grok" : profile,
    tool: flags.tool || (profile === "agent" ? "grok" : profile),
    extraContext: flags.context || flags.cwd ? `Working directory: ${flags.cwd || process.cwd()}` : "",
    strengthId: flags.strength || undefined,
  });

  if (!composed.ok) {
    console.error(composed.error);
    process.exitCode = 1;
    return;
  }

  const promptText = composed.improved; // clean body without export comment noise
  if (flags.copy) await maybeCopyAndOut(promptText, flags);

  if (flags["print-only"] || flags.print) {
    process.stdout.write(promptText.endsWith("\n") ? promptText : promptText + "\n");
    console.error(
      `[compose] ${composed.meta?.directionLabel || direction} → ${profile}`
    );
    return;
  }

  console.error(
    `[compose] ${composed.meta?.directionLabel || direction} · patterns: ${(composed.meta?.patterns || []).join(", ") || "-"}`
  );

  const result = await runAgent(agentId, promptText, {
    cwd: flags.cwd || process.cwd(),
    headless: Boolean(flags.headless),
    yes: Boolean(flags.yes || flags.yolo),
    model: flags.model,
  });

  if (!result.ok) {
    if (result.error) console.error(result.error);
    if (result.detected) console.error("\n" + formatAgentsTable(result.detected));
    process.exitCode = result.code || 1;
    return;
  }
  process.exitCode = result.code ?? 0;
}

function cmdServe(flags) {
  const port = flags.port || process.env.PORT || "3847";
  process.env.PORT = String(port);
  const serverPath = path.join(ROOT, "server.js");
  console.error(`Starting Prompter UI on http://127.0.0.1:${port}`);
  import(pathToFileURL(serverPath).href).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  const cmd = argv[0];
  const parsed = parseArgs(argv.slice(1));
  const flags = parsed.flags;

  switch (cmd) {
    case "serve":
      cmdServe(flags);
      break;
    case "agents":
    case "detect":
      cmdAgents(flags);
      break;
    case "run":
    case "do":
    case "go":
      await cmdRun(parsed, flags);
      break;
    case "make":
    case "compose":
      // prompter make "text" --direction implement
      // prompter make - --direction debug  (stdin)
      {
        const arg = parsed._[0];
        if (arg && arg !== "-") {
          // positional string as input
          const fakeFlags = { ...flags };
          const result = await (async () => {
            const target = fakeFlags.target || "generic";
            const direction = fakeFlags.direction || "freeform";
            let composed = composeAndExport({
              input: arg,
              directionId: direction,
              profileId: target,
              tool: fakeFlags.tool || target,
              extraContext: fakeFlags.context || "",
              strengthId: fakeFlags.strength || undefined,
            });
            if (!composed.ok) {
              console.error(composed.error);
              process.exitCode = 1;
              return;
            }
            let text = composed.text || composed.improved;
            process.stdout.write(text.endsWith("\n") ? text : text + "\n");
            console.error(`[${target}] ${composed.meta?.directionLabel || direction}`);
            await maybeCopyAndOut(text, fakeFlags);
          })();
          break;
        }
        await cmdImprove(arg || "-", flags, false);
      }
      break;
    case "directions":
      cmdDirections(flags);
      break;
    case "list":
      await cmdList(flags);
      break;
    case "show":
      if (!parsed._[0]) {
        console.error("usage: prompter show <id>");
        process.exitCode = 1;
        break;
      }
      cmdShow(parsed._[0]);
      break;
    case "use":
      if (!parsed._[0]) {
        console.error("usage: prompter use <id> --var k=v");
        process.exitCode = 1;
        break;
      }
      await cmdUse(parsed._[0], flags);
      break;
    case "export":
      if (!parsed._[0]) {
        console.error("usage: prompter export <id> --tool skill");
        process.exitCode = 1;
        break;
      }
      flags.tool = flags.tool || "generic";
      await cmdUse(parsed._[0], flags);
      break;
    case "improve":
      await cmdImprove(parsed._[0] || "-", flags, false);
      break;
    case "pipe":
      await cmdImprove("-", { ...flags, direction: flags.direction || "freeform" }, true);
      break;
    case "patterns":
      cmdPatterns(flags);
      break;
    case "tools":
      console.log(TOOLS.join("\n"));
      break;
    case "doctor":
      cmdDoctor();
      break;
    case "catalog":
      console.log(
        JSON.stringify(
          { directions: listDirections(), library: libraryIndex(), improve: listCatalog() },
          null,
          2
        )
      );
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
