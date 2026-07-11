const $ = (id) => document.getElementById(id);

const state = {
  catalog: null,
  agents: [],
  autoAgent: null,
  agentId: null, // selected CLI
  direction: "implement",
  lastShell: "",
  history: loadHistory(),
};

const SAMPLES = {
  freeform: `hey can you look at my project and make the homepage better? fonts and layout feel off.`,
  implement: `Add a dark mode toggle on the settings page that persists in localStorage`,
  review: `src/auth/: especially session cookies and the OAuth callback`,
  debug: `Checkout fails only on Safari when the cart has a discount code`,
  "fix-error": `TypeError: Cannot read properties of undefined (reading 'id')\n    at Checkout.tsx:88`,
  tests: `the payment webhook handler and retry logic`,
  refactor: `Extract billing logic out of app.js into a small module without behavior change`,
  explain: `how authentication sessions work in this repo`,
  ui: `homepage hero and pricing section: too generic, needs stronger hierarchy`,
  landing: `Prompter: local tool that rewrites prompts for coding agents`,
  docs: `how to run Prompter CLI and copy a prompt into Codex`,
  research: `best QLoRA settings for 7B models on a 24GB GPU`,
  train: `Qwen2.5-7B-Instruct on data/training/sft.jsonl using QLoRA`,
  pr: `Added OAuth callback, fixed cookie Secure flag, updated README`,
  mission: `Migrate the CMS to Postgres, keep sqlite for local dev, prove tests pass`,
};

const EXPORT_LABELS = {
  codex: "Chat (match tool)",
  claude: "Chat (match tool)",
  grok: "Chat (match tool)",
  gemini: "Chat (match tool)",
  cursor: "Chat (match tool)",
  copilot: "Chat (match tool)",
  generic: "Generic chat",
  agents_md: "AGENTS.md snippet",
  skill: "Agent Skill (SKILL.md)",
  system: "System message",
  clipboard: "Plain text",
  agy: "Chat (match tool)",
  agent: "Chat (match tool)",
};

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem("prompter.history") || "[]");
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem("prompter.history", JSON.stringify(state.history.slice(0, 40)));
}

function toast(msg, isErr = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function countWords(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateInStats() {
  $("in-stats").textContent = `${countWords($("input").value)} words`;
}

function updateOutStats(meta) {
  const t = $("output").value;
  if (!t) {
    $("out-stats").textContent = "-";
    $("mode-pill").classList.add("hidden");
    return;
  }
  $("out-stats").textContent = `${countWords(t)} words`;
  const pill = $("mode-pill");
  if (meta?.agent || meta?.directionLabel) {
    pill.textContent = [meta.agent, meta.directionLabel].filter(Boolean).join(" · ");
    pill.classList.remove("hidden");
  } else {
    pill.classList.add("hidden");
  }
}

function profileForAgent(id) {
  if (id === "agent") return "grok";
  if (id === "agy") return "generic";
  return id || "generic";
}

function currentDirection() {
  const list = state.catalog?.directions || [];
  return list.find((d) => d.id === state.direction) || list[0] || null;
}

function applyDirectionUI() {
  const d = currentDirection();
  if (!d) return;
  $("input-label").textContent = d.inputLabel || "Describe the task";
  $("input").placeholder = d.placeholder || "What should the agent do?";
  $("direction-blurb").textContent = d.blurb || "";
  document.querySelectorAll(".dir-card").forEach((el) => {
    el.setAttribute("aria-checked", el.dataset.id === state.direction ? "true" : "false");
  });
}

function renderAgents() {
  const root = $("agent-grid");
  const loading = $("agent-loading");
  if (loading) loading.remove();
  root.innerHTML = "";

  const ready = state.agents.filter((a) => a.available);
  const missing = state.agents.filter((a) => !a.available);

  $("agent-count").textContent =
    ready.length > 0 ? `${ready.length} ready` : "none found";
  $("agent-status").textContent =
    ready.length > 0
      ? `Using ${state.agentId || "-"}`
      : "No CLIs found";
  $("agent-status").classList.toggle("on", ready.length > 0);

  if (!ready.length) {
    root.innerHTML = `<div class="agent-empty">
      No coding CLIs detected. Install <code>grok</code>, <code>codex</code>, <code>claude</code>, <code>gemini</code>, or <code>agy</code>, then hit Rescan.
    </div>`;
    $("agent-hint").textContent = "";
    $("btn-run").disabled = true;
    return;
  }

  $("btn-run").disabled = false;

  for (const a of ready) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "agent-card";
    btn.dataset.id = a.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", a.id === state.agentId ? "true" : "false");
    btn.innerHTML = `
      <span class="agent-ready">Ready</span>
      <span class="agent-name">${escapeHtml(a.name)}</span>
      <span class="agent-id">${escapeHtml(a.id)}</span>
      <span class="agent-path" title="${escapeHtml(a.path)}">${escapeHtml(shortPath(a.path))}</span>
    `;
    btn.addEventListener("click", () => selectAgent(a.id));
    root.appendChild(btn);
  }

  if (missing.length) {
    const foot = document.createElement("div");
    foot.className = "agent-missing";
    foot.textContent = `Not found: ${missing.map((m) => m.id).join(", ")}`;
    root.appendChild(foot);
  }

  const sel = state.agents.find((a) => a.id === state.agentId && a.available);
  $("agent-hint").textContent = sel
    ? `Selected ${sel.name}. Prompts will be shaped for this tool, then opened in Terminal.`
    : "Click a Ready CLI above.";
}

function shortPath(p) {
  if (!p) return "";
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function selectAgent(id) {
  state.agentId = id;
  localStorage.setItem("prompter.agentId", id);
  document.querySelectorAll(".agent-card").forEach((el) => {
    el.setAttribute("aria-checked", el.dataset.id === id ? "true" : "false");
  });
  $("agent-status").textContent = `Using ${id}`;
  $("agent-status").classList.add("on");
  const exp = $("export-tool");
  const profile = profileForAgent(id);
  if (exp && [...exp.options].some((o) => o.value === profile)) {
    exp.value = profile;
  }
  $("agent-hint").textContent = `Selected ${id}. Hit Run in Terminal when ready.`;
}

function renderDirections() {
  const root = $("direction-grid");
  root.innerHTML = "";
  for (const d of state.catalog?.directions || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dir-card";
    btn.dataset.id = d.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", d.id === state.direction ? "true" : "false");
    btn.innerHTML = `<span class="dir-label">${escapeHtml(d.label)}</span>
      <span class="dir-blurb">${escapeHtml(d.blurb)}</span>`;
    btn.addEventListener("click", () => {
      state.direction = d.id;
      localStorage.setItem("prompter.direction", d.id);
      applyDirectionUI();
    });
    root.appendChild(btn);
  }
  applyDirectionUI();
}

function renderHistory() {
  const ul = $("history");
  ul.innerHTML = "";
  $("history-count").textContent = `${state.history.length}`;
  for (const item of state.history) {
    const li = document.createElement("li");
    const main = document.createElement("div");
    main.className = "h-main";
    main.innerHTML = `
      <div class="h-title">${escapeHtml(item.preview)}</div>
      <div class="h-meta">${escapeHtml(item.agent || "")} · ${escapeHtml(item.direction || "")} · ${escapeHtml(item.when)}</div>
    `;
    main.addEventListener("click", () => {
      if (item.input) $("input").value = item.input;
      $("output").value = item.improved || "";
      state.lastShell = item.shell || "";
      $("btn-copy").disabled = !item.improved;
      $("btn-copy-cmd").disabled = !item.shell;
      if (item.agentId) selectAgent(item.agentId);
      if (item.directionId) {
        state.direction = item.directionId;
        applyDirectionUI();
      }
      updateInStats();
      updateOutStats({ agent: item.agent, directionLabel: item.direction });
      toast("Loaded");
    });
    const actions = document.createElement("div");
    actions.className = "h-actions";
    const rerun = document.createElement("button");
    rerun.type = "button";
    rerun.className = "ghost";
    rerun.textContent = "Run again";
    rerun.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (item.input) $("input").value = item.input;
      if (item.agentId) selectAgent(item.agentId);
      if (item.directionId) {
        state.direction = item.directionId;
        applyDirectionUI();
      }
      updateInStats();
      await runInTerminal();
    });
    actions.appendChild(rerun);
    li.appendChild(main);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

function pushHistory(entry) {
  const preview =
    (entry.improved || "")
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---")) ||
    entry.input?.slice(0, 80) ||
    "run";
  state.history.unshift({
    id: crypto.randomUUID(),
    ...entry,
    preview: String(preview).slice(0, 100),
    when: new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
  saveHistory();
  renderHistory();
}

async function scanAgents() {
  $("agent-status").textContent = "Scanning…";
  $("agent-grid").innerHTML =
    `<div class="agent-loading">Scanning for grok, codex, claude, gemini, agy…</div>`;
  try {
    const res = await fetch("/api/agents");
    const data = await res.json();
    state.agents = data.agents || [];
    state.autoAgent = data.auto;

    const saved = localStorage.getItem("prompter.agentId");
    const savedOk = state.agents.find((a) => a.id === saved && a.available);
    state.agentId = savedOk?.id || data.auto?.id || null;

    renderAgents();
    if (state.agentId) selectAgent(state.agentId);
    toast(
      state.agentId
        ? `Found CLIs. Selected ${state.agentId}`
        : "No CLIs detected"
    );
  } catch (err) {
    $("agent-grid").innerHTML = `<div class="agent-empty">Could not scan. Is the server running? (${escapeHtml(err.message)})</div>`;
    $("agent-status").textContent = "Scan failed";
    toast("Agent scan failed", true);
  }
}

async function previewOnly() {
  const input = $("input").value.trim();
  if (!input) {
    toast("Type a task first", true);
    return;
  }
  if (!state.agentId) {
    toast("Pick a Ready CLI first", true);
    return;
  }
  const label = $("btn-improve")?.querySelector(".btn-label-preview");
  if (label) label.textContent = "…";
  try {
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        direction: state.direction,
        profile: profileForAgent(state.agentId),
        tool: $("export-tool").value || profileForAgent(state.agentId),
        extraContext: $("extra").value,
        strength: $("strength").value || undefined,
        useLlm: $("use-llm").checked,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(data.error || "Compose failed", true);
      return;
    }
    const text = data.text || data.improved;
    $("output").value = text;
    $("btn-copy").disabled = false;
    updateOutStats({
      agent: state.agentId,
      directionLabel: data.meta?.directionLabel,
    });
    if ($("auto-copy").checked) {
      try {
        await navigator.clipboard.writeText(text);
        toast("Prompt ready + copied");
      } catch {
        toast("Prompt ready");
      }
    } else toast("Prompt ready");
  } catch (e) {
    toast(e.message || "Server offline", true);
  } finally {
    if (label) label.textContent = "Preview only";
  }
}

async function runInTerminal() {
  const input = $("input").value.trim();
  if (!input) {
    toast("Type what you want done", true);
    $("input").focus();
    return;
  }
  if (!state.agentId) {
    toast("Click a Ready CLI above first", true);
    return;
  }

  const btn = $("btn-run");
  const label = btn.querySelector(".btn-label");
  btn.disabled = true;
  if (label) label.textContent = "Launching…";

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        agent: state.agentId,
        direction: state.direction,
        profile: profileForAgent(state.agentId),
        tool: $("export-tool").value || profileForAgent(state.agentId),
        extraContext: $("extra").value,
        strength: $("strength").value || undefined,
        useLlm: $("use-llm").checked,
        cwd: $("cwd").value.trim() || undefined,
        launch: true,
        headless: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(data.error || "Run failed", true);
      if (data.agents) {
        state.agents = data.agents;
        renderAgents();
      }
      return;
    }

    const promptText = data.composed?.text || "";
    $("output").value = promptText;
    $("btn-copy").disabled = !promptText;
    state.lastShell = data.shell || data.launch?.shell || "";
    $("btn-copy-cmd").disabled = !state.lastShell;
    updateOutStats({
      agent: data.agent?.id,
      directionLabel: data.composed?.meta?.directionLabel,
    });

    const banner = $("launch-banner");
    banner.hidden = false;
    $("launch-title").textContent =
      data.launch?.launched === "terminal"
        ? `Opening ${data.agent?.name || state.agentId} in Terminal`
        : `Command ready for ${data.agent?.name || state.agentId}`;
    $("launch-detail").textContent =
      data.launch?.message ||
      "A Terminal window should open with your agent. Complete the task there.";
    $("launch-cmd").textContent = state.lastShell || "(no shell string)";

    if ($("auto-copy").checked && promptText) {
      try {
        await navigator.clipboard.writeText(promptText);
      } catch {
        /* ignore */
      }
    }

    pushHistory({
      input,
      improved: promptText,
      shell: state.lastShell,
      agent: data.agent?.name || state.agentId,
      agentId: state.agentId,
      direction: data.composed?.meta?.directionLabel,
      directionId: state.direction,
    });

    toast(
      data.launch?.launched === "terminal"
        ? `Terminal → ${data.agent?.id}`
        : "Command ready. Copy it if Terminal didn’t open"
    );
  } catch (e) {
    toast(e.message || "Server offline. Try npm start.", true);
  } finally {
    btn.disabled = false;
    if (label) label.textContent = "Run in Terminal";
  }
}

function setupOnboarding() {
  const key = "prompter.onboarded.v3";
  if (!localStorage.getItem(key)) $("onboarding").hidden = false;
  $("btn-dismiss-onboarding").addEventListener("click", () => {
    localStorage.setItem(key, "1");
    $("onboarding").hidden = true;
  });
}

async function init() {
  const savedDir = localStorage.getItem("prompter.direction");
  if (savedDir) state.direction = savedDir;

  const catRes = await fetch("/api/catalog");
  state.catalog = await catRes.json();

  renderDirections();

  const tools = state.catalog.tools || Object.keys(EXPORT_LABELS);
  $("export-tool").innerHTML = tools
    .map((id) => `<option value="${id}">${EXPORT_LABELS[id] || id}</option>`)
    .join("");

  if (state.catalog.llm?.available) {
    $("llm-hint").textContent = `(${state.catalog.llm.name})`;
  } else {
    $("use-llm").checked = false;
    $("llm-hint").textContent = "(optional)";
  }

  // Always scan CLIs on load / refresh
  await scanAgents();

  $("btn-rescan").addEventListener("click", () => scanAgents());
  $("input").addEventListener("input", updateInStats);
  $("btn-run").addEventListener("click", runInTerminal);
  $("btn-improve").addEventListener("click", previewOnly);
  $("btn-sample").addEventListener("click", () => {
    $("input").value = SAMPLES[state.direction] || SAMPLES.implement;
    updateInStats();
    toast("Example loaded");
  });
  $("btn-paste").addEventListener("click", async () => {
    try {
      $("input").value = await navigator.clipboard.readText();
      updateInStats();
      toast("Pasted");
    } catch {
      toast("Use ⌘V to paste", true);
    }
  });
  $("btn-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("output").value);
    toast("Prompt copied");
  });
  $("btn-copy-cmd").addEventListener("click", async () => {
    if (!state.lastShell) return;
    await navigator.clipboard.writeText(state.lastShell);
    toast("Shell command copied");
  });
  $("btn-clear-history").addEventListener("click", () => {
    state.history = [];
    saveHistory();
    renderHistory();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runInTerminal();
    }
  });

  setupOnboarding();
  updateInStats();
  renderHistory();
}

init().catch((err) => {
  console.error(err);
  toast("Load failed. Run npm start.", true);
});
