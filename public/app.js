const $ = (id) => document.getElementById(id);

const state = {
  catalog: null,
  agents: [],
  autoAgent: null,
  agentId: null,
  direction: "implement",
  lastShell: "",
  history: loadHistory(),
  projectId: null,
  project: null,
  workshopReady: false,
  token: null,
  lastEvidence: [],
  lastPromptTokens: null,
  showAllDirections: false,
};

async function ensureSession() {
  if (state.token) return state.token;
  const res = await fetch("/api/session");
  const data = await res.json();
  if (!data.ok || !data.token) throw new Error("Could not start session. Restart Prompter.");
  state.token = data.token;
  return state.token;
}

async function api(path, opts = {}) {
  await ensureSession();
  const headers = {
    ...(opts.headers || {}),
    "X-Prompter-Token": state.token,
  };
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.method && opts.method !== "GET") {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const res = await fetch(path, { ...opts, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: "Bad response from Prompter" };
  }
  if (res.status === 401) {
    state.token = null;
    try {
      await ensureSession();
      headers.Authorization = `Bearer ${state.token}`;
      headers["X-Prompter-Token"] = state.token;
      const retry = await fetch(path, { ...opts, headers });
      data = await retry.json().catch(() => ({ ok: false }));
      if (retry.status === 401) {
        throw new Error("Prompter restarted. Choose your project folder again.");
      }
      // fall through to 409 handling with retried data
      if (retry.status === 409 || data.code === "PROJECT_GONE" || data.code === "PROJECT_REQUIRED") {
        state.projectId = null;
        state.project = null;
        showAttachScreen();
        throw new Error(data.error || "Choose your project folder again.");
      }
      return { res: retry, data };
    } catch (e) {
      if (e.message?.includes("Choose your project") || e.message?.includes("restarted")) throw e;
      throw new Error("Prompter restarted. Choose your project folder again.");
    }
  }
  if (res.status === 409 || data.code === "PROJECT_GONE" || data.code === "PROJECT_REQUIRED") {
    state.projectId = null;
    state.project = null;
    showAttachScreen();
    throw new Error(data.error || "Choose your project folder again.");
  }
  return { res, data };
}

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
      <strong>No coding AI apps found on this computer.</strong>
      <p>Install one of these, then click Rescan:</p>
      <ul class="agent-install">
        <li><a href="https://docs.x.ai/" target="_blank" rel="noopener">Grok Build</a></li>
        <li><a href="https://github.com/openai/codex" target="_blank" rel="noopener">OpenAI Codex CLI</a></li>
        <li><a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener">Claude Code</a></li>
        <li><a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noopener">Gemini CLI</a></li>
      </ul>
      <p class="muted">You can still use <strong>Show prompt</strong> to copy text into a browser chat.</p>
    </div>`;
    $("agent-hint").textContent = "No apps installed yet — Show prompt still works.";
    $("btn-run").disabled = true;
    $("btn-improve").disabled = false;
    return;
  }

  $("btn-run").disabled = false;
  $("btn-improve").disabled = false;

  for (const a of ready) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "agent-card";
    btn.dataset.id = a.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", a.id === state.agentId ? "true" : "false");
    const selected = a.id === state.agentId;
    btn.innerHTML = `
      <span class="agent-ready">${selected ? "Selected" : "Ready"}</span>
      <span class="agent-name">${escapeHtml(a.name)}</span>
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
    ? `Using ${sel.name}. Run opens it in Terminal with your project folder.`
    : "Click an installed app above.";
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
  const sel = state.agents.find((a) => a.id === id);
  $("agent-status").textContent = `Using ${sel?.name || id}`;
  $("agent-status").classList.add("on");
  const exp = $("export-tool");
  const profile = profileForAgent(id);
  if (exp && [...exp.options].some((o) => o.value === profile)) {
    exp.value = profile;
  }
  $("agent-hint").textContent = `Selected ${sel?.name || id}. Type your task, then Run.`;
  document.querySelectorAll(".agent-card .agent-ready").forEach((el) => {
    const card = el.closest(".agent-card");
    if (!card) return;
    el.textContent = card.dataset.id === id ? "Selected" : "Ready";
  });
}

const PRIMARY_DIRS = ["implement", "debug", "fix-error", "review", "explain", "freeform"];

function renderDirections() {
  const root = $("direction-grid");
  root.innerHTML = "";
  const all = state.catalog?.directions || [];
  const primary = all.filter((d) => PRIMARY_DIRS.includes(d.id));
  const rest = all.filter((d) => !PRIMARY_DIRS.includes(d.id));
  const showAll = state.showAllDirections;
  const list = showAll ? all : primary.length ? primary : all;

  for (const d of list) {
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
  if (rest.length && !showAll) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "dir-card dir-more";
    more.innerHTML = `<span class="dir-label">More…</span><span class="dir-blurb">${rest.length} other tasks</span>`;
    more.addEventListener("click", () => {
      state.showAllDirections = true;
      renderDirections();
    });
    root.appendChild(more);
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
    `<div class="agent-loading">Looking for coding AI apps on this computer…</div>`;
  try {
    const { data } = await api("/api/agents");
    state.agents = data.agents || [];
    state.autoAgent = data.auto;

    const saved = localStorage.getItem("prompter.agentId");
    const savedOk = state.agents.find((a) => a.id === saved && a.available);
    state.agentId = savedOk?.id || data.auto?.id || null;

    renderAgents();
    if (state.agentId) selectAgent(state.agentId);
    toast(
      state.agentId
        ? `Found apps. Using ${state.agentId}`
        : "No coding AI apps found"
    );
  } catch (err) {
    $("agent-grid").innerHTML = `<div class="agent-empty">Could not scan. Double-click Start Prompter again and leave that window open. (${escapeHtml(err.message)})</div>`;
    $("agent-status").textContent = "Scan failed";
    toast("Could not scan for apps", true);
  }
}

function showAttachScreen() {
  $("screen-attach").hidden = false;
  $("screen-workshop").hidden = true;
  $("btn-change-project").hidden = true;
  $("btn-rescan").hidden = true;
  $("agent-status").hidden = true;
  $("context-status").hidden = true;
  $("logo-sub").textContent = "attach project → prompt → run";
}

function showWorkshopScreen() {
  $("screen-attach").hidden = true;
  $("screen-workshop").hidden = false;
  $("btn-change-project").hidden = false;
  $("btn-rescan").hidden = false;
  $("agent-status").hidden = false;
  $("logo-sub").textContent = "project loaded · pick app → run";
  updateProjectContextUI();
}

function humanReason(r) {
  const s = String(r || "");
  if (s.startsWith("name~") || s.startsWith("path~")) return "Matched your task words";
  if (s.startsWith("body")) return "Found in file text";
  if (s.includes("entry")) return "Likely project entry file";
  if (s.includes("exact path")) return "Path you mentioned";
  if (s.includes("always include")) return "Project metadata";
  if (s.includes("fallback")) return "Default pick";
  return "Related to your task";
}

function updateProjectContextUI(meta) {
  const p = state.project;
  const status = $("context-status");
  const usedEl = $("counter-used");
  const evidenceEl = $("evidence-list");
  const promptEl = $("counter-prompt");

  if (usedEl) usedEl.hidden = true;
  if (promptEl) promptEl.hidden = true;
  if (evidenceEl) {
    evidenceEl.hidden = true;
    evidenceEl.innerHTML = "";
  }

  if (!p) {
    if (status) status.hidden = true;
    return;
  }

  $("project-chip-name").textContent = p.name || p.path || "Project";
  $("project-chip-path").textContent = shortPath(p.path || "");
  if ($("cwd")) $("cwd").value = p.path || "";

  const files = p.fileCount ?? 0;
  const tokens = p.tokens ?? 0;
  const size = p.bytesLabel || "-";

  $("counter-files").innerHTML = `<strong>${files}</strong> indexed`;
  $("counter-tokens").innerHTML = `<strong>~${formatTokens(tokens)}</strong> index size`;
  $("counter-size").innerHTML = `<strong>${escapeHtml(size)}</strong> on disk`;

  const usedFiles = meta?.projectFiles || meta?.usedFiles || state.lastEvidence;
  const promptTokens = meta?.promptTokens ?? state.lastPromptTokens;
  if (Array.isArray(usedFiles) && usedFiles.length) {
    usedEl.hidden = false;
    $("counter-used-n").textContent = String(usedFiles.length);
  }
  if (promptTokens != null && promptEl) {
    promptEl.hidden = false;
    promptEl.innerHTML = `<strong>~${formatTokens(promptTokens)}</strong> in last prompt`;
  }

  if (evidenceEl) {
    const ev = meta?.evidence || state.lastEvidence;
    if (Array.isArray(ev) && ev.length && typeof ev[0] === "object") {
      evidenceEl.hidden = false;
      const show = ev.slice(0, 8);
      const more = ev.length - show.length;
      evidenceEl.innerHTML =
        `<div class="evidence-title">Files used for last prompt</div>` +
        show
          .map(
            (e) =>
              `<div class="evidence-row"><code>${escapeHtml(e.path)}</code>` +
              (e.reasons?.length
                ? `<span class="muted"> ${escapeHtml(humanReason(e.reasons[0]))}</span>`
                : "") +
              `</div>`
          )
          .join("") +
        (more > 0 ? `<div class="evidence-row muted">+${more} more</div>` : "");
    } else if (Array.isArray(usedFiles) && usedFiles.length && typeof usedFiles[0] === "string") {
      evidenceEl.hidden = false;
      evidenceEl.innerHTML =
        `<div class="evidence-title">Files used for last prompt</div>` +
        usedFiles
          .slice(0, 8)
          .map((p) => `<div class="evidence-row"><code>${escapeHtml(p)}</code></div>`)
          .join("");
    }
  }

  status.hidden = false;
  $("context-status-text").textContent = `Context loaded · ${files} files`;
  status.title = `${p.name || "Project"}: ${files} files indexed, ~${formatTokens(tokens)} index tokens, ${size}`;
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

async function attachProjectFlow() {
  const btn = $("btn-attach");
  const hint = $("attach-hint");
  const loading = $("attach-loading");
  btn.disabled = true;
  hint.textContent = "";
  hint.className = "field-hint";
  $("attach-title").textContent = "Choose project folder";
  $("attach-sub").textContent = "Opening folder picker…";

  try {
    const { data: pick } = await api("/api/pick-folder", { method: "POST" });
    if (!pick.ok) throw new Error(pick.error || "Picker failed");
    if (pick.cancelled || !pick.path) {
      $("attach-sub").textContent = "Opens the normal folder picker";
      toast("No folder chosen");
      return;
    }

    loading.hidden = false;
    btn.hidden = true;
    $("attach-loading-title").textContent = "Reading your project…";
    $("attach-loading-sub").textContent = pick.path;
    hint.textContent = "Looking through the code on this computer…";
    hint.className = "field-hint ok";

    const { data } = await api("/api/attach-project", {
      method: "POST",
      body: JSON.stringify({ path: pick.path, ticket: pick.ticket }),
    });
    if (!data.ok) throw new Error(data.error || "Could not read project");

    state.projectId = data.project.id;
    state.project = data.project;
    state.lastEvidence = [];
    state.lastPromptTokens = null;
    sessionStorage.setItem("prompter.projectPath", data.project.path);

    showWorkshopScreen();
    if (!state.workshopReady) {
      await ensureWorkshop();
    } else {
      await scanAgents();
    }
    toast(`Project context loaded · ${data.project.fileCount} files`);
  } catch (e) {
    hint.textContent = e.message || "Attach failed";
    hint.className = "field-hint err";
    toast(e.message || "Attach failed", true);
  } finally {
    btn.disabled = false;
    btn.hidden = false;
    loading.hidden = true;
    $("attach-sub").textContent = "Opens the normal folder picker";
  }
}

async function ensureWorkshop() {
  if (state.workshopReady) return;
  const savedDir = localStorage.getItem("prompter.direction");
  if (savedDir) state.direction = savedDir;

  await ensureSession();
  const { data: catalog } = await api("/api/catalog");
  state.catalog = catalog;
  renderDirections();
  // Platform-aware run shortcut label
  const kbd = $("run-kbd");
  if (kbd) {
    kbd.textContent = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘↵" : "Ctrl+Enter";
  }

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

  await scanAgents();
  setupWorkshopHandlers();
  setupOnboarding();
  updateInStats();
  renderHistory();
  state.workshopReady = true;
}

function setupWorkshopHandlers() {
  if (setupWorkshopHandlers._done) return;
  setupWorkshopHandlers._done = true;

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
      if ($("screen-workshop").hidden) return;
      e.preventDefault();
      if (!state.agentId || $("btn-run")?.disabled) previewOnly();
      else runInTerminal();
    }
  });
}

function composeBody(input) {
  const profile = profileForAgent(state.agentId || "generic");
  return {
    input,
    direction: state.direction,
    profile,
    tool: ($("export-tool") && $("export-tool").value) || profile,
    extraContext: ($("extra") && $("extra").value) || "",
    strength: ($("strength") && $("strength").value) || undefined,
    useLlm: Boolean($("use-llm") && $("use-llm").checked),
    projectId: state.projectId || undefined,
  };
}

async function previewOnly() {
  const input = $("input").value.trim();
  if (!input) {
    toast("Type a task first", true);
    return;
  }
  if (!state.projectId) {
    toast("Attach a project first", true);
    return;
  }
  const btnImp = $("btn-improve");
  const label = btnImp?.querySelector(".btn-label-preview");
  if (label) label.textContent = "Reading code…";
  if (btnImp) btnImp.disabled = true;
  try {
    const { data } = await api("/api/compose", {
      method: "POST",
      body: JSON.stringify(composeBody(input)),
    });
    if (!data.ok) {
      toast(data.error || "Could not build prompt", true);
      return;
    }
    if (data.llmError) toast(`Extra AI rewrite failed: ${data.llmError}`, true);
    const text = data.text || data.improved;
    $("output").value = text;
    $("btn-copy").disabled = false;
    const outTitle = document.querySelector(".out-pane .pane-bar h2");
    if (outTitle) outTitle.textContent = "Prompt ready for your AI";
    updateOutStats({
      agent: state.agentId,
      directionLabel: data.meta?.directionLabel,
    });
    state.lastEvidence = data.meta?.evidence || data.meta?.projectFiles || [];
    state.lastPromptTokens = data.meta?.promptTokens ?? null;
    updateProjectContextUI(data.meta);
    pushHistory({
      input,
      improved: text,
      shell: "",
      agent: state.agentId || "copy",
      agentId: state.agentId,
      direction: data.meta?.directionLabel,
      directionId: state.direction,
    });
    $("output")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if ($("auto-copy").checked) {
      try {
        await navigator.clipboard.writeText(text);
        toast(
          data.meta?.projectFiles?.length
            ? `Prompt ready (${data.meta.projectFiles.length} files) + copied`
            : "Prompt ready + copied"
        );
      } catch {
        toast("Prompt ready");
      }
    } else {
      toast(
        data.meta?.projectFiles?.length
          ? `Prompt ready · ${data.meta.projectFiles.length} project files`
          : "Prompt ready"
      );
    }
  } catch (e) {
    toast(e.message || "Prompter stopped. Open Start Prompter again.", true);
  } finally {
    if (label) label.textContent = "Show prompt";
    if (btnImp) btnImp.disabled = false;
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
    toast("Click an installed AI app first (or use Show prompt)", true);
    return;
  }
  if (!state.projectId) {
    toast("Attach a project first", true);
    return;
  }

  const btn = $("btn-run");
  const label = btn.querySelector(".btn-label");
  btn.disabled = true;
  if (label) label.textContent = "Reading code…";

  try {
    const { data } = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({
        ...composeBody(input),
        agent: state.agentId,
        launch: true,
        headless: false,
      }),
    });
    if (!data.ok) {
      toast(data.error || "Run failed", true);
      if (data.agents) {
        state.agents = data.agents;
        renderAgents();
      }
      return;
    }
    if (data.llmError) toast(`Extra AI rewrite failed: ${data.llmError}`, true);

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
        ? `Look at Terminal: ${data.agent?.name || state.agentId} is opening`
        : `Command ready for ${data.agent?.name || state.agentId}`;
    $("launch-detail").textContent =
      data.launch?.message ||
      "A Terminal window should open with your coding app. Finish the task there. This browser page can stay open.";
    $("launch-cmd").textContent = state.lastShell || "";
    if ($("launch-cmd")) {
      $("launch-cmd").hidden = !state.lastShell || data.launch?.launched === "terminal";
    }

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

    state.lastEvidence = data.composed?.meta?.evidence || data.composed?.meta?.projectFiles || [];
    state.lastPromptTokens = data.composed?.meta?.promptTokens ?? null;
    updateProjectContextUI(data.composed?.meta);
    const used = data.composed?.meta?.projectFiles?.length;
    toast(
      data.launch?.launched === "terminal"
        ? `Check Terminal${used ? ` · ${used} files in prompt` : ""}`
        : "Command ready. Copy it if Terminal did not open"
    );
  } catch (e) {
    toast(e.message || "Prompter stopped. Open Start Prompter again.", true);
  } finally {
    btn.disabled = false;
    if (label) label.textContent = "Run in Terminal";
  }
}

function setupOnboarding() {
  const key = "prompter.onboarded.v4";
  if (!localStorage.getItem(key)) $("onboarding").hidden = false;
  $("btn-dismiss-onboarding").addEventListener("click", () => {
    localStorage.setItem(key, "1");
    $("onboarding").hidden = true;
  });
}

async function init() {
  showAttachScreen();
  try {
    await ensureSession();
  } catch (e) {
    toast(e.message || "Could not connect. Open Start Prompter again.", true);
  }
  $("btn-attach").addEventListener("click", attachProjectFlow);
  $("btn-change-project").addEventListener("click", async () => {
    try {
      if (state.projectId) {
        await api("/api/detach-project", {
          method: "POST",
          body: JSON.stringify({ projectId: state.projectId }),
        });
      }
    } catch {
      /* ignore */
    }
    state.projectId = null;
    state.project = null;
    state.lastEvidence = [];
    state.lastPromptTokens = null;
    sessionStorage.removeItem("prompter.projectPath");
    showAttachScreen();
  });

  $("btn-reindex")?.addEventListener("click", async () => {
    if (!state.projectId) return;
    const btn = $("btn-reindex");
    if (btn) btn.disabled = true;
    try {
      const { data } = await api("/api/reindex-project", {
        method: "POST",
        body: JSON.stringify({ projectId: state.projectId }),
      });
      if (!data.ok) throw new Error(data.error || "Re-scan failed");
      state.projectId = data.project.id;
      state.project = data.project;
      state.lastEvidence = [];
      state.lastPromptTokens = null;
      updateProjectContextUI();
      toast(`Re-scanned · ${data.project.fileCount} files`);
    } catch (e) {
      toast(e.message || "Re-scan failed", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

init().catch((err) => {
  console.error(err);
  toast("Could not load. Double-click Start Prompter and leave that window open.", true);
});
