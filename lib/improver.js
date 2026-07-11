/**
 * Local prompt improvement engine (no API required).
 * Optional LLM polish is applied by the server when configured.
 */

import { PROFILES, TASK_TYPES, STRENGTHS } from "./profiles.js";

function cleanWhitespace(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFiller(text) {
  let t = text;
  const fillers = [
    /\bplease\s+/gi,
    /\bif you (?:could|can|would)\s+/gi,
    /\bI was wondering if\s+/gi,
    /\bjust\s+(?=want|need|make|do|create|build|write)/gi,
    /\bsort of\s+/gi,
    /\bkind of\s+/gi,
    /\bbasically\s+/gi,
    /\bobviously\s+/gi,
  ];
  for (const re of fillers) t = t.replace(re, "");
  return cleanWhitespace(t);
}

function detectHints(raw) {
  const lower = raw.toLowerCase();
  return {
    hasPaths: /[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|md|css|html|json|toml|yaml|yml)\b/.test(raw) ||
      /`[^`]+`/.test(raw) ||
      /\b(src|frontend|backend|configs|scripts)\//.test(raw),
    hasCommands: /\b(npm|pnpm|yarn|cargo|pytest|python|docker|git|npx)\b/i.test(raw),
    wantsPlan: /\b(plan|design doc|architecture|approach)\b/i.test(raw),
    wantsCode: /\b(implement|code|fix|refactor|build|write|patch|pr)\b/i.test(raw),
    wantsReview: /\b(review|audit|critique|improve)\b/i.test(raw),
    mentionsSkills: /\$[a-z0-9-]+|\.agents\/skills|AGENTS\.md|CLAUDE\.md/i.test(raw),
    isVague: raw.trim().split(/\s+/).length < 12,
  };
}

function extractGoal(raw) {
  const first = raw.split(/\n/)[0].trim();
  if (first.length > 0 && first.length < 220) return first.replace(/^[.]+/, "");
  const sentence = raw.match(/^[^.!?\n]+[.!?]?/);
  return sentence ? sentence[0].trim() : raw.slice(0, 160).trim();
}

function buildLight(raw, profile, task) {
  const cleaned = stripFiller(raw);
  const tips = [...profile.tips.slice(0, 2), ...task.extras.slice(0, 1)];
  return cleanWhitespace(
    `${cleaned}

---
Target: ${profile.name}. ${tips.map((t) => `• ${t}`).join(" ")}`
  );
}

function buildMedium(raw, profile, task, hints) {
  const cleaned = stripFiller(raw);
  const goal = extractGoal(cleaned);

  const lines = [
    `# Prompt (${profile.name})`,
    "",
    "## Goal",
    goal,
    "",
    "## Context",
    cleaned,
    "",
    "## Constraints",
    "- Prefer concrete, complete outputs over placeholders.",
    "- Do not invent files or APIs that are not in scope.",
  ];

  if (task.id === "coding") {
    lines.push("- Match existing project conventions and style.");
    if (!hints.hasPaths) lines.push("- If paths are unclear, inspect the repo before editing.");
  }
  if (task.id === "design") {
    lines.push("- Avoid generic AI UI clichés (Inter-only, purple gradients, nested cards).");
  }
  if (task.id === "training") {
    lines.push("- Do not train on held-out eval/gold data unless explicitly requested.");
  }

  lines.push(
    "",
    "## Output",
    hints.wantsReview && !hints.wantsCode
      ? "- Provide a structured review first; implement only if asked."
      : "- Deliver the requested artifact fully (no truncated stubs).",
    "",
    "## Success criteria",
    hints.hasCommands
      ? "- Run any commands mentioned (or the project’s usual check) and fix failures."
      : "- Result should be immediately usable without follow-up clarification on the core ask.",
    "",
    `## Notes for ${profile.name}`,
    ...profile.tips.slice(0, 3).map((t) => `- ${t}`),
    ...task.extras.map((t) => `- ${t}`)
  );

  return cleanWhitespace(lines.join("\n"));
}

function buildStrong(raw, profile, task, hints) {
  const cleaned = stripFiller(raw);
  const goal = extractGoal(cleaned);

  const lines = [
    `# Agent brief: ${profile.name}`,
    "",
    profile.preamble,
    "",
    "## 1. Primary goal",
    goal,
    "",
    "## 2. Full user intent (source)",
    cleaned,
    "",
    "## 3. Working assumptions",
    hints.isVague
      ? "- User prompt is thin: infer reasonable defaults, but surface assumptions in one short list before heavy work."
      : "- Treat the user text as authoritative; only ask questions if blocked.",
    hints.hasPaths
      ? "- Prefer the files/paths referenced; expand scope only if required for correctness."
      : "- Discover relevant files in-repo before large edits.",
    hints.mentionsSkills
      ? "- Load any referenced skills / AGENTS.md / CLAUDE.md before acting."
      : `- If the repo has AGENTS.md or .agents/skills/, follow them for ${profile.name}-relevant work.`,
    "",
    "## 4. Required structure to follow while working",
    ...profile.structure.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## 5. Hard constraints",
    "- No half-finished code, TODO-only stubs, or “add later” comments for required behavior.",
    "- No drive-by refactors outside the ask.",
    "- Preserve existing behavior unless the task is a redesign/rewrite.",
  ];

  if (task.id === "coding") {
    lines.push(
      "- Prefer minimal, reviewable diffs.",
      "- After edits: run the most relevant tests/linters if available."
    );
  }
  if (task.id === "design") {
    lines.push(
      "- Avoid AI-slop aesthetics; commit to a clear visual direction.",
      "- Check mobile + desktop hierarchy."
    );
  }
  if (task.id === "training") {
    lines.push(
      "- State base model, method (SFT/DPO/LoRA/QLoRA), data paths, and eval plan.",
      "- Never contaminate training with held-out gold unless user overrides."
    );
  }

  lines.push(
    "",
    "## 6. Anti-patterns to avoid",
    "- Vague motivational filler without a concrete deliverable.",
    "- Inventing libraries/config the project doesn’t use.",
    "- Claiming success without verification when checks exist."
  );

  if (task.id === "design") {
    lines.push("- Purple gradients, Inter-everywhere, card grids as the default hero.");
  }

  lines.push(
    "",
    "## 7. Definition of done",
    hints.wantsPlan && !hints.wantsCode
      ? "- A clear plan with ordered steps, risks, and files to touch. No premature full rewrite."
      : "- The user’s ask is fully satisfied in the response or codebase.",
    hints.hasCommands
      ? "- Mentioned or standard project commands pass (or failures are fixed/explained)."
      : "- Output is copy-paste ready or merge-ready.",
    "",
    "## 8. Output format",
    hints.wantsReview
      ? "- Start with findings (severity-ordered), then optional patches."
      : "- Lead with the deliverable; put brief notes after if needed.",
    "",
    `## 9. ${profile.name}-specific guidance`,
    ...profile.tips.map((t) => `- ${t}`),
    ...task.extras.map((t) => `- ${t}`)
  );

  return cleanWhitespace(lines.join("\n"));
}

/**
 * When prompt is already a structured template scaffold, only add target guidance
 * (don't re-wrap into another Goal/Context shell).
 */
function polishScaffold(scaffold, profile, task) {
  const body = cleanWhitespace(scaffold);
  return cleanWhitespace(
    `${profile.preamble}

${body}

---
## For ${profile.name}
${profile.tips.map((t) => `- ${t}`).join("\n")}
${task.extras.map((t) => `- ${t}`).join("\n")}

Deliver complete work. No placeholder stubs.`
  );
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.profileId]
 * @param {string} [opts.taskId]
 * @param {string} [opts.strengthId]
 * @param {string} [opts.extraContext]
 * @param {boolean} [opts.preserveStructure] - prompt is already templated
 */
export function improvePromptLocal(opts) {
  const profile = PROFILES[opts.profileId] || PROFILES.generic;
  const task = TASK_TYPES[opts.taskId] || TASK_TYPES.general;
  const strength = STRENGTHS[opts.strengthId] || STRENGTHS.medium;
  const raw = cleanWhitespace(opts.prompt || "");
  const extra = cleanWhitespace(opts.extraContext || "");

  if (!raw) {
    return {
      ok: false,
      error: "Prompt is empty.",
      improved: "",
      meta: {},
    };
  }

  const combined = extra ? `${raw}\n\nAdditional context:\n${extra}` : raw;
  const hints = detectHints(combined);

  let improved;
  if (opts.preserveStructure) {
    // Direction templates already have the right shape
    improved = polishScaffold(combined, profile, task);
  } else if (strength.id === "light") {
    improved = buildLight(combined, profile, task);
  } else if (strength.id === "strong") {
    improved = buildStrong(combined, profile, task, hints);
  } else {
    improved = buildMedium(combined, profile, task, hints);
  }

  return {
    ok: true,
    improved,
    original: raw,
    meta: {
      profile: profile.id,
      profileName: profile.name,
      task: task.id,
      strength: strength.id,
      hints,
      mode: opts.preserveStructure ? "scaffold-polish" : "local",
      charCount: { in: raw.length, out: improved.length },
      wordCount: {
        in: raw.split(/\s+/).filter(Boolean).length,
        out: improved.split(/\s+/).filter(Boolean).length,
      },
    },
  };
}

export function listCatalog() {
  return {
    profiles: Object.values(PROFILES).map((p) => ({
      id: p.id,
      name: p.name,
      short: p.short,
      color: p.color,
    })),
    tasks: Object.values(TASK_TYPES).map((t) => ({ id: t.id, name: t.name })),
    strengths: Object.values(STRENGTHS).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
  };
}
