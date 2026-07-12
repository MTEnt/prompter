# Prompter

**Local context layer for coding agents** — not another agent, and not just a prompt rewriter.

Attach a project on your computer. Prompter indexes symbols (tree-sitter), expands related files (imports / tests / references), builds a **scoped evidence pack**, then opens the coding CLI you already use (Grok, Codex, Claude, Gemini, …).

Local only. No account. No Prompter telemetry.

### What it is

1. Choose a **project folder** (system picker).
2. Prompter **indexes** the repo: files + **symbols** + lightweight **graph** (JS/TS imports, tests, references).
3. You pick a coding app and type a task.
4. On **Show prompt** or **Run**, retrieval returns **direct** matches, **graph-expanded** related sites, and **supporting** files — then launches the agent in that folder.

**Honest limit:** ranking is still largely lexical + graph expansion, not full semantic “codebase understanding.” Use the evidence panel (exclude paths) before trusting cloud agents.

### Measure it

```bash
npm test          # smoke + retrieval eval on a labeled fixture
npm run test:eval # retrieval recall only
```

Optional: advanced users can polish with a local or API LLM via `.env` (see `.env.example`). Core flow needs no keys.

### Privacy (honest)

| What | Stays local? |
|------|----------------|
| Folder scan, ranking, prompt build | Yes, on this computer |
| Prompter itself | No account, no telemetry |
| Coding CLI you open (Claude, Codex, Grok, …) | Follows **that tool’s** privacy policy (often cloud) |
| Optional “Extra AI rewrite” | Sends a short brief to the provider in `.env` if enabled |

So: Prompter is local. The agent you launch may still send the prompt (including ranked file excerpts) to its vendor.

---

## How to open it

### One-time: install Node.js

If you do not have it: [nodejs.org](https://nodejs.org) → **LTS** → install like any normal app.  
(npm comes with Node; Prompter uses it automatically.)

### Every time: double-click one file

| Mac | Windows | Linux |
|-----|---------|--------|
| `Start Prompter.command` | `Start Prompter.bat` | `start-prompter.sh` |

That single file will:

1. Install missing dependencies if needed (first run may take a minute + internet)
2. Start Prompter on this computer
3. Open your browser to **http://127.0.0.1:3847**

A black window opens. **Leave it open.** Close it to quit.

You do **not** need to run `npm install` yourself.

---

### If double-click does not work

**Mac**  
Right-click `Start Prompter.command` → **Open** → confirm (Gatekeeper).

**Linux** (once):

```bash
chmod +x start-prompter.sh
./start-prompter.sh
```

**"Node is not installed"**  
Install Node LTS from https://nodejs.org, then double-click again.

---

## What to do in the app

1. **Choose project folder** (one click, normal folder picker). Wait while Prompter reads the code.
2. **Click an AI tool** that says **Ready**.
3. **Click what you want** (build a feature, fix a bug, review code, etc.).
4. **Type your request** in plain English.
5. Click **Run in Terminal**.

Prompter looks through your project files before building the prompt, then opens your CLI in that folder.

- **Show prompt** = build the prompt without opening the AI.
- **Copy** = copy the prompt yourself if you want to paste it somewhere else.

---

## Notes

- Prompter runs **on your computer**. It does not need an account.
- You need at least one AI coding app installed and set up (Grok, Codex, Claude Code, Gemini CLI, etc.) for "Run in Terminal" to do anything useful.
- Optional: advanced users can add a `.env` file for extra features (see `.env.example`). Do not upload that file if it has secret keys.

---

## License

MIT. Free to use.
