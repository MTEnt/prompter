# Prompter

Local-first **prompt library + improver + CLI** for every major AI coding tool:

**Codex · Claude / Claude Code · Grok · Gemini · Cursor · GitHub Copilot**

- Web UI on `http://127.0.0.1:3847`
- Curated multi-template library with variables
- Local rewrite engine (no API keys required)
- Optional LLM second pass
- Export as chat prompt, `AGENTS.md` fragment, or Agent **Skill** (`SKILL.md`)

## Quick start

```bash
cd Prompter   # or: git clone <your-repo> && cd <repo>
npm start
# open http://127.0.0.1:3847
```

On load, the web UI **scans for installed agent CLIs** (grok, codex, claude, gemini, agy, …). Click one, pick a direction, describe the task, **Run in Terminal**.

### Compose + run from the CLI

```bash
node bin/prompter.js agents          # what’s installed?
node bin/prompter.js doctor          # library + agents health

# auto-pick first available agent
node bin/prompter.js run "Add dark mode to settings" --direction implement --agent auto

# explicit agent
node bin/prompter.js run "review src/auth" --direction review --agent codex
node bin/prompter.js run "checkout fails on Safari" --direction debug --agent claude
node bin/prompter.js run "polish homepage" --direction ui --agent grok

# headless single-shot (where supported)
node bin/prompter.js run "summarize this repo" --direction freeform --agent claude --headless

# compose only (no launch)
node bin/prompter.js make "Add dark mode" --direction implement --target codex --copy
```

Optional alias (adjust path to your clone):

```bash
chmod +x bin/prompter.js
# alias prompter='node /path/to/Prompter/bin/prompter.js'
```

## CLI reference

| Command | Purpose |
|---------|---------|
| `serve` | Start web UI |
| `list` | List templates (`--tag` `--category` `--target` `--query` `--json`) |
| `show <id>` | Print template + body |
| `use <id>` | Render vars → optional improve → export |
| `improve [file\|-]` | Improve raw prompt |
| `pipe` | stdin → improve → stdout (shell glue) |
| `export <id> --tool skill` | Skill / agents_md / system wrappers |
| `patterns` | List pattern cards |
| `tools` | Export tool ids |
| `doctor` | Sanity check library + LLM |

### Examples

```bash
# Codex-ready feature brief
node bin/prompter.js use implement-feature \
  --var goal="Wire OAuth callback" \
  --var paths="src/auth/" \
  --target codex --improve --copy

# Claude Code debug
node bin/prompter.js use debug-systematic \
  --var symptom="flaky test in payments" \
  --target claude --copy

# Export a portable Agent Skill skeleton
node bin/prompter.js export skill-author --tool skill \
  --var skill_name="deploy-check" \
  --var when_to_use="user asks to verify deploy readiness" \
  --out /tmp/SKILL.md

# Shell pipe
echo "make the about page less ugly" | node bin/prompter.js pipe --target grok --strength strong

# Improve a file for Gemini
node bin/prompter.js improve ./rough.txt --target gemini --strength medium --copy
```

### `use` / `export` flags

- `--var name=value` (repeatable)
- `--target codex|claude|grok|gemini|cursor|copilot|generic`
- `--tool skill|agents_md|system|clipboard|…` (export wrapper)
- `--improve` run local improver after render
- `--llm` optional API polish (needs `.env`)
- `--copy` clipboard
- `--out file`

## Web UI (simple path)

1. **Who** — Codex / Claude / Grok / Gemini / Cursor / Copilot  
2. **What** — pick a **direction** (Build, Review, Debug, UI, …)  
3. **Describe** it in plain English → **Make prompt** → **Copy**

Templates and patterns are **pre-wired into each direction**. You never browse them unless you use advanced CLI.

```bash
prompter directions
prompter make "Add dark mode" --direction implement --target codex --copy
```

## Library layout

```text
library/
  sources.md                 # attribution / research notes
  patterns/*.md              # technique cards
  templates/
    coding/                  # implement, review, debug, tests, …
    design/                  # UI redesign, landing
    training/                # LoRA/SFT plan, dataset audit
    research/
    writing/
    agent/                   # skills, AGENTS.md, multi-step missions
    meta/                    # improve-prompt, new template
```

Each template is markdown with YAML frontmatter + `{{variables}}` / `{{var|default}}`.

## Multi-tool exports

| Tool id | Use |
|---------|-----|
| `codex` | OpenAI Codex chat |
| `claude` | Claude / Claude Code |
| `grok` | Grok / Grok Build |
| `gemini` | Gemini / Gemini CLI |
| `cursor` | Cursor agent chat |
| `copilot` | GitHub Copilot Chat |
| `agents_md` | Fragment for `AGENTS.md` |
| `skill` | Agent Skills `SKILL.md` skeleton |
| `system` | System-message style preamble |
| `clipboard` / `generic` | Plain |

## Optional LLM polish

```bash
cp .env.example .env
# OPENAI_API_KEY=…
# XAI_API_KEY=…
# OPENROUTER_API_KEY=…
# or PROMPTER_LLM_BASE_URL=http://127.0.0.1:11434/v1
```

Then `--llm` on the CLI or the UI checkbox.

## Project layout

```text
Prompter/
  bin/prompter.js       # CLI
  server.js             # HTTP API + static UI
  lib/                  # improver, library, profiles, LLM
  library/              # templates + patterns
  public/               # web UI
```

Zero runtime npm dependencies (Node 18+).

## Research basis

See `library/sources.md` — informed by prompts.chat, ai-boost/awesome-prompts, DAIR PE Guide, Anthropic tutorials, Agent Skills / AGENTS.md ecosystem. Templates are original compositions, not bulk dumps.

## Privacy & what not to commit

- Local compose never sends prompts off-machine unless you enable LLM polish or launch an agent
- LLM polish only runs with keys in a local `.env` (gitignored)
- Agent detection only reads your PATH / common install locations; paths are not committed
- **Do not commit:** `.env`, API keys, PEM/private keys, auth dumps, personal notes

Safe to publish: source under `bin/`, `lib/`, `library/`, `public/`, plus `.env.example` and this README.

## License

MIT (use freely; no warranty).
