# Prompter

**Attach a project on your computer. Pick an AI coding CLI. Type a messy request. Prompter reads your code, writes a solid prompt, and opens the tool for you.**

Local only. No account. Nothing is uploaded.

Works with tools you already have: Grok, Codex, Claude, Gemini, and similar CLIs.

### What it is

A small localhost workshop for people who use coding agents but do not want to hand-craft prompts:

1. Choose a **project folder** (normal system picker).
2. Prompter **reads the codebase** on your machine, **parses symbols with tree-sitter** (functions, classes, methods), and shows **project context loaded** (files + symbols).
3. Pick a **Ready** coding app, pick what you want done, type a sentence.
4. On **Show prompt** or **Run**, it matches your words to **real symbols and files**, injects signatures and targeted bodies (not a blind whole-repo dump), and can launch the CLI in that project folder.

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
