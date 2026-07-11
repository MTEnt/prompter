# Prompter

**You type a messy request. Prompter turns it into a good prompt and opens your AI coding tool.**

Works with tools you already have on your computer: Grok, Codex, Claude, Gemini, and similar CLIs.

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

1. **Click an AI tool** that says **Ready** (Prompter finds them on your machine).
2. **Click what you want** (build a feature, fix a bug, review code, etc.).
3. **Type your request** in plain English.
4. Click **Run in Terminal**.

That is the whole flow.

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
