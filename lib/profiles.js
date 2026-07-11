/** Target-agent profiles: how to shape prompts for each model/product. */

export const PROFILES = {
  codex: {
    id: "codex",
    name: "Codex",
    short: "OpenAI coding agent",
    color: "#10a37f",
    tips: [
      "Prefer repo-rooted paths, concrete files, and shell-verifiable success criteria.",
      "Invoke skills with $skill-name when the project has .agents/skills/.",
      "Ask for plan-then-implement only when scope is large; otherwise direct edits.",
      "State AGENTS.md / design or training skills if they apply.",
    ],
    structure: [
      "Role & goal",
      "Repo / working context",
      "Skills or rules to load",
      "Exact task & scope (files)",
      "Constraints (do / don't)",
      "Definition of done (commands to run)",
      "Output format (diff, PR, report-only, etc.)",
    ],
    preamble:
      "You are working in a local repository with Codex. Prefer precise file edits, runnable checks, and skill invocation when relevant.",
  },
  grok: {
    id: "grok",
    name: "Grok",
    short: "xAI Grok / Grok Build",
    color: "#e8e8e8",
    tips: [
      "Clear goal + constraints; Grok handles tool use well when the ask is explicit.",
      "Call out when you want witty brevity vs rigorous engineering depth.",
      "For Grok Build / CLI: point at skills, AGENTS.md, and local paths.",
      "Say if web search or X search is allowed/desired.",
    ],
    structure: [
      "Intent (one sentence)",
      "Context & files",
      "Constraints",
      "Desired depth / tone",
      "Success criteria",
      "Output shape",
    ],
    preamble:
      "You are Grok helping with a practical task. Be direct, technically sharp, and complete. No half-finished stubs.",
  },
  claude: {
    id: "claude",
    name: "Claude",
    short: "Claude / Claude Code",
    color: "#d97757",
    tips: [
      "Claude Code loves CLAUDE.md, skills, and clear project conventions.",
      "Use structured sections; Claude follows long constraints well.",
      "Separate research/planning from implementation when multi-step.",
      "Ask for extended thinking only when the problem is genuinely hard.",
    ],
    structure: [
      "Role",
      "Project context",
      "Relevant docs/skills",
      "Task breakdown",
      "Hard constraints",
      "Verification steps",
      "Deliverables",
    ],
    preamble:
      "You are Claude (or Claude Code). Follow project instruction files, use skills when available, and produce careful, complete work.",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    short: "Google Gemini / Gemini CLI",
    color: "#8ab4f8",
    tips: [
      "State multimodal needs (images, large context) explicitly.",
      "Gemini CLI skills live under ~/.gemini/skills or project skills if enabled.",
      "Be explicit about code vs explanation vs plan-only.",
      "For long context: say which files/folders matter most.",
    ],
    structure: [
      "Goal",
      "Inputs (files, images, links)",
      "Constraints",
      "Steps if multi-phase",
      "Output format",
      "Checks",
    ],
    preamble:
      "You are Gemini assisting on a concrete task. Prefer accurate structure, clear steps, and complete artifacts.",
  },
  generic: {
    id: "generic",
    name: "Generic",
    short: "Any LLM",
    color: "#c4a574",
    tips: [
      "Goal, context, constraints, format, success criteria. Always.",
      "Remove filler; use imperative verbs.",
      "One primary ask per prompt when possible.",
    ],
    structure: [
      "Goal",
      "Context",
      "Constraints",
      "Output format",
      "Success criteria",
    ],
    preamble:
      "You are a capable assistant. Follow the instructions below carefully and completely.",
  },
};

export const TASK_TYPES = {
  coding: {
    id: "coding",
    name: "Coding / agent",
    extras: [
      "Name exact files/paths when known.",
      "Include build/test/lint commands for done-ness.",
      "Prefer minimal diffs unless a rewrite is requested.",
    ],
  },
  design: {
    id: "design",
    name: "Design / UI",
    extras: [
      "State aesthetic direction (and anti-patterns to avoid).",
      "Specify breakpoints and a11y expectations.",
      "Reference DESIGN.md / design skills if present.",
    ],
  },
  training: {
    id: "training",
    name: "ML / fine-tune / LoRA",
    extras: [
      "Base model, method (SFT/DPO/LoRA/QLoRA), data path, VRAM budget.",
      "Never train on held-out eval unless user insists.",
      "Ask for train plan → config → run → eval sequence.",
    ],
  },
  research: {
    id: "research",
    name: "Research / analysis",
    extras: [
      "Define sources allowed and citation expectations.",
      "Ask for conclusions + uncertainty, not only links.",
    ],
  },
  writing: {
    id: "writing",
    name: "Writing / docs",
    extras: [
      "Audience, tone, length, and must-include points.",
      "Say whether to draft vs edit existing text.",
    ],
  },
  general: {
    id: "general",
    name: "General",
    extras: ["Keep structure tight; one primary outcome."],
  },
};

export const STRENGTHS = {
  light: {
    id: "light",
    name: "Light",
    description: "Clean up and mild structure; keep your voice.",
  },
  medium: {
    id: "medium",
    name: "Medium",
    description: "Full scaffold: goal, context, constraints, done criteria.",
  },
  strong: {
    id: "strong",
    name: "Strong",
    description: "Agent-ready brief with checklists, anti-patterns, and explicit DoD.",
  },
};
