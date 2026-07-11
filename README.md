# Prompter

**Attach a project on your computer. Pick an AI coding CLI. Type a messy request. Prompter reads your code, writes a solid prompt, and opens the tool for you.**

Local only. No account. Nothing is uploaded.

Works with tools you already have: Grok, Codex, Claude, Gemini, and similar CLIs.

### What it is

A small localhost workshop for people who use coding agents but do not want to hand-craft prompts:

1. Choose a **project folder** (normal system picker).
2. Prompter **reads the codebase** on your machine and shows **project context loaded** (file / token counters).
3. Pick a **Ready** CLI, pick what you want done, type a sentence.
4. On **Preview** or **Run**, it ranks real files against your request, builds a grounded prompt, and can launch the CLI in that project folder.

Optional: advanced users can polish with a local or API LLM via `.env` (see `.env.example`). Core flow needs no keys.

---

## How to open it

### 1. Install Node.js (one time)

If you do not have it yet: [nodejs.org](https://nodejs.org) → download **LTS** → install like any normal app.

### 2. Start Prompter

Download or clone this folder, then **double-click** the file for your computer:

| Mac | Windows | Linux |
|-----|---------|--------|
| `Start Prompter.command` | `Start Prompter.bat` | `start-prompter.sh` |

A black window will open. **Leave it open.**  
Your browser should go to: **http://127.0.0.1:3847**

To quit: close that black window.

---

### If double-click does not work

**Mac**  
Right-click `Start Prompter.command` → **Open** → confirm.

**Linux** (once in a terminal, inside this folder):

```bash
chmod +x start-prompter.sh
./start-prompter.sh
```

**"Node is not installed"**  
You skipped step 1. Install Node.js, then try again.

---

## What to do in the app

1. **Choose project folder** (one click, normal folder picker). Wait while Prompter reads the code.
2. **Click an AI tool** that says **Ready**.
3. **Click what you want** (build a feature, fix a bug, review code, etc.).
4. **Type your request** in plain English.
5. Click **Run in Terminal**.

Prompter looks through your project files before building the prompt, then opens your CLI in that folder.

- **Preview only** = build the prompt without opening the AI.
- **Copy** = copy the prompt yourself if you want to paste it somewhere else.

---

## Notes

- Prompter runs **on your computer**. It does not need an account.
- You need at least one AI coding app installed and set up (Grok, Codex, Claude Code, Gemini CLI, etc.) for "Run in Terminal" to do anything useful.
- Optional: advanced users can add a `.env` file for extra features (see `.env.example`). Do not upload that file if it has secret keys.

---

## License

MIT. Free to use.
