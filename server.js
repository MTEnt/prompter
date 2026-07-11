import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { improvePromptLocal, listCatalog } from "./lib/improver.js";
import { detectLlmConfig, polishWithLlm } from "./lib/llm-polish.js";
import {
  libraryIndex,
  loadPatterns,
  getTemplate,
  searchTemplates,
  renderTemplate,
  exportForTool,
} from "./lib/library.js";
import { listDirections } from "./lib/directions.js";
import { composeAndExport } from "./lib/compose.js";
import {
  detectAgents,
  pickAgent,
  launchAgentInTerminal,
  buildAgentInvocation,
} from "./lib/agents.js";
import {
  attachProject,
  buildContextForQuery,
  consumeAttachTicket,
  detachProject,
  issueAttachTicket,
  requireProject,
} from "./lib/project/context.js";
import { pickFolderNative } from "./lib/project/pick-folder.js";
import crypto from "node:crypto";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3847;
let HOST = process.env.HOST || "127.0.0.1";
const ALLOW_LAN = process.env.PROMPTER_ALLOW_LAN === "1";
if (!ALLOW_LAN && HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
  console.warn(`[prompter] Refusing non-loopback HOST=${HOST}; using 127.0.0.1 (set PROMPTER_ALLOW_LAN=1 to override)`);
  HOST = "127.0.0.1";
}

/** Per-process session token — UI loads it from /api/session */
const SESSION_TOKEN =
  process.env.PROMPTER_TOKEN || crypto.randomBytes(24).toString("hex");
const TOKEN_FILE = path.join(os.tmpdir(), `prompter-token-${PORT}`);
try {
  fs.writeFileSync(TOKEN_FILE, SESSION_TOKEN, { encoding: "utf8", mode: 0o600 });
} catch {
  /* ignore */
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function send(res, status, body, headers = {}) {
  const data =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isJson
      ? "application/json; charset=utf-8"
      : headers["Content-Type"] || "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(data);
}

const MAX_BODY = 1.5 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.resolve(path.join(root, clean));
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

function isLoopbackAddr(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

function peerAllowed(req) {
  if (ALLOW_LAN) return true;
  const ra = req.socket?.remoteAddress;
  return isLoopbackAddr(ra);
}

function hostAllowed(req) {
  const h = String(req.headers.host || "")
    .split(":")[0]
    .toLowerCase();
  if (!h) return false;
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
}

function authOk(req) {
  const hdr = req.headers.authorization || "";
  const m = hdr.match(/^Bearer\s+(\S+)/i);
  const token = m?.[1] || req.headers["x-prompter-token"];
  if (!token || typeof token !== "string") return false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(SESSION_TOKEN);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function requireMutatingAuth(req, res) {
  if (!peerAllowed(req)) {
    send(res, 403, { ok: false, error: "Remote clients blocked (local only)" });
    return false;
  }
  if (!ALLOW_LAN && !hostAllowed(req)) {
    send(res, 403, { ok: false, error: "Host not allowed" });
    return false;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !authOk(req)) {
    send(res, 401, { ok: false, error: "Unauthorized. Refresh the page." });
    return false;
  }
  return true;
}

async function composePipeline(body) {
  const input = body.input || body.prompt || "";
  if (!String(input).trim()) {
    return { ok: false, error: "Describe what you need first." };
  }

  const need = requireProject(body.projectId);
  if (!need.ok) return need;
  const project = need.project;

  const slice = buildContextForQuery(project, input);
  let result = composeAndExport({
    input,
    directionId: body.direction || body.directionId || "freeform",
    profileId: body.profile || body.target || "generic",
    tool: body.tool || body.profile || body.target || "generic",
    extraContext: body.extraContext || "",
    strengthId: body.strength || undefined,
    projectContext: slice.text,
    projectFiles: slice.usedFiles,
    projectPath: project.path,
    evidence: slice.evidence,
    promptTokens: slice.promptTokens,
  });
  if (!result.ok) return result;

  result.meta = {
    ...result.meta,
    evidence: slice.evidence,
    promptTokens: slice.promptTokens,
    indexedFiles: project.files.length,
    indexedTokens: project.stats?.tokens ?? null,
  };

  if (body.useLlm) {
    // Do not send full file bodies to remote polish — brief only
    const briefOnly = [
      `Direction: ${result.meta.directionLabel || body.direction}`,
      `User request:\n${input}`,
      `Relevant paths: ${(slice.usedFiles || []).join(", ")}`,
      `Local draft (may omit large code blocks):\n${String(result.improved).slice(0, 6000)}`,
    ].join("\n\n");
    const polished = await polishWithLlm({
      original: input,
      localImproved: briefOnly,
      profileName: body.profile || "generic",
      taskName: result.meta?.task || "general",
      strengthName: result.meta?.strength || "medium",
      providerId: body.llmProvider,
    });
    if (polished.ok) {
      // Guidance from LLM + project excerpts only (do not double-paste full local draft)
      const merged = [
        polished.improved.trim(),
        "",
        "---",
        "",
        slice.text,
        "",
        `Working directory: ${project.path}`,
        `User request: ${input}`,
      ].join("\n");
      const exported = exportForTool(merged, body.tool || body.profile || "generic", {
        title: result.meta?.directionLabel || "Prompt",
      });
      result = {
        ...result,
        improved: merged,
        text: exported.text,
        hint: exported.hint,
        meta: {
          ...result.meta,
          mode: `${result.meta.mode}+llm`,
          llmProvider: polished.provider,
          llmModel: polished.model,
        },
      };
    } else {
      result.llmError = polished.error;
    }
  }

  return result;
}

async function handleApi(req, res, url) {
  if (!peerAllowed(req)) {
    return send(res, 403, { ok: false, error: "Remote clients blocked (local only)" });
  }
  if (!ALLOW_LAN && !hostAllowed(req)) {
    return send(res, 403, { ok: false, error: "Host not allowed" });
  }

  // All mutating API routes need auth (except nothing - session is GET)
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!authOk(req)) {
      return send(res, 401, { ok: false, error: "Unauthorized. Refresh the page." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const idx = libraryIndex();
    return send(res, 200, {
      ok: true,
      name: "prompter",
      version: "1.2.0",
      llm: detectLlmConfig(),
      library: idx.count,
      localOnly: true,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    return send(res, 200, {
      ok: true,
      token: SESSION_TOKEN,
      host: HOST,
      port: PORT,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    return send(res, 200, {
      ...listCatalog(),
      directions: listDirections(),
      llm: detectLlmConfig(),
      tools: [
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
      ],
    });
  }

  if (req.method === "GET" && url.pathname === "/api/directions") {
    return send(res, 200, { directions: listDirections() });
  }

  if (req.method === "GET" && url.pathname === "/api/agents") {
    const agents = detectAgents();
    const pick = pickAgent("auto");
    return send(res, 200, {
      ok: true,
      agents,
      auto: pick.ok ? pick.agent : null,
      platform: process.platform,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/pick-folder") {
    if (!requireMutatingAuth(req, res)) return;
    try {
      const folder = await pickFolderNative();
      if (!folder) return send(res, 200, { ok: true, cancelled: true, path: null });
      const ticket = issueAttachTicket(folder);
      return send(res, 200, { ok: true, cancelled: false, path: folder, ticket });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || String(e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/attach-project") {
    if (!requireMutatingAuth(req, res)) return;
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message || "Invalid JSON body" });
    }
    const p = String(body.path || "").trim();
    if (!p) return send(res, 400, { ok: false, error: "No folder path" });
    const ticket = consumeAttachTicket(body.ticket, p, { peek: true });
    if (!ticket.ok) return send(res, 400, ticket);
    try {
      const meta = await attachProject(ticket.path, { structureOnly: false });
      consumeAttachTicket(body.ticket, p, { consume: true });
      return send(res, 200, { ok: true, project: meta });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || String(e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/detach-project") {
    if (!requireMutatingAuth(req, res)) return;
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      /* empty */
    }
    detachProject(body.projectId);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    if (!requireMutatingAuth(req, res)) return;
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message || "Invalid JSON body" });
    }

    const agentId = body.agent || "auto";
    const pick = pickAgent(agentId);
    if (!pick.ok) {
      return send(res, 400, {
        ok: false,
        error: pick.error,
        agents: pick.detected,
      });
    }

    const profile =
      body.profile ||
      (pick.agent.id === "agent" ? "grok" : pick.agent.id);

    const composed = await composePipeline({
      ...body,
      profile,
      tool: body.tool || profile,
    });
    if (!composed.ok) {
      const status = composed.code === "PROJECT_GONE" || composed.code === "PROJECT_REQUIRED" ? 409 : 400;
      return send(res, status, composed);
    }

    const promptText = composed.improved;
    // cwd only from attached project (ignore client override for safety)
    const need = requireProject(body.projectId);
    const cwd = need.ok ? need.project.path : process.cwd();

    const inv = buildAgentInvocation(pick.agent.id, promptText, {
      cwd,
      headless: Boolean(body.headless),
      yes: false, // never honor auto-approve from HTTP
      model: typeof body.model === "string" && /^[a-zA-Z0-9._:/-]+$/.test(body.model) ? body.model : undefined,
    });

    let launch = null;
    if (body.launch !== false) {
      launch = await launchAgentInTerminal(pick.agent.id, promptText, {
        cwd,
        headless: Boolean(body.headless),
        yes: false,
        model: typeof body.model === "string" && /^[a-zA-Z0-9._:/-]+$/.test(body.model) ? body.model : undefined,
      });
    }

    return send(res, 200, {
      ok: true,
      agent: pick.agent,
      composed: {
        text: promptText,
        meta: composed.meta,
      },
      shell: inv.ok ? inv.shell : null,
      cwd,
      launch,
      llmError: composed.llmError,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/compose") {
    if (!requireMutatingAuth(req, res)) return;
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message || "Invalid JSON body" });
    }

    const result = await composePipeline(body);
    if (!result.ok) {
      const status = result.code === "PROJECT_GONE" || result.code === "PROJECT_REQUIRED" ? 409 : 400;
      return send(res, status, result);
    }
    return send(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/library") {
    return send(res, 200, libraryIndex());
  }

  if (req.method === "GET" && url.pathname === "/api/library/search") {
    const results = searchTemplates(url.searchParams.get("q") || "", {
      tag: url.searchParams.get("tag") || "",
      category: url.searchParams.get("category") || "",
      target: url.searchParams.get("target") || "",
    });
    return send(res, 200, {
      results: results.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        tags: t.tags,
        targets: t.targets,
        variables: t.variables,
        defaultTask: t.defaultTask,
        defaultStrength: t.defaultStrength,
      })),
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/library/templates/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/library/templates/", ""));
    const t = getTemplate(id);
    if (!t) return send(res, 404, { ok: false, error: "Template not found" });
    return send(res, 200, t);
  }

  if (req.method === "GET" && url.pathname === "/api/library/patterns") {
    return send(res, 200, { patterns: loadPatterns() });
  }

  if (req.method === "POST" && url.pathname === "/api/library/render") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { ok: false, error: "Invalid JSON body" });
    }
    const t = getTemplate(body.id);
    if (!t) return send(res, 404, { ok: false, error: "Template not found" });
    const rendered = renderTemplate(t, body.variables || {});
    if (!rendered.ok) return send(res, 400, rendered);

    let text = rendered.text;
    let meta = { mode: "template", templateId: t.id };

    if (body.improve) {
      const local = improvePromptLocal({
        prompt: text,
        profileId: body.target || "generic",
        taskId: body.task || t.defaultTask,
        strengthId: body.strength || t.defaultStrength,
        extraContext: body.extraContext || "",
      });
      text = local.improved;
      meta = { ...local.meta, templateId: t.id, mode: "template+local" };
    }

    if (body.useLlm) {
      const polished = await polishWithLlm({
        original: rendered.text,
        localImproved: text,
        profileName: body.target || "generic",
        taskName: body.task || t.defaultTask,
        strengthName: body.strength || t.defaultStrength,
        providerId: body.llmProvider,
      });
      if (polished.ok) {
        text = polished.improved;
        meta = {
          ...meta,
          mode: "template+llm",
          llmProvider: polished.provider,
          llmModel: polished.model,
        };
      } else {
        meta.llmError = polished.error;
      }
    }

    const exported = exportForTool(text, body.tool || body.target || "generic", {
      id: t.id,
      title: t.title,
      description: t.description,
    });

    return send(res, 200, {
      ok: true,
      text: exported.text,
      raw: text,
      hint: exported.hint,
      meta,
      template: { id: t.id, title: t.title },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/improve") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { ok: false, error: "Invalid JSON body" });
    }

    const local = improvePromptLocal({
      prompt: body.prompt || "",
      profileId: body.profile || "generic",
      taskId: body.task || "general",
      strengthId: body.strength || "medium",
      extraContext: body.extraContext || "",
    });

    if (!local.ok) return send(res, 400, local);

    const useLlm = Boolean(body.useLlm);
    if (!useLlm) {
      const exported = exportForTool(local.improved, body.tool || body.profile || "generic", {
        title: "Improved prompt",
      });
      return send(res, 200, { ...local, text: exported.text, hint: exported.hint });
    }

    const polished = await polishWithLlm({
      original: local.original,
      localImproved: local.improved,
      profileName: local.meta.profileName,
      taskName: body.task || "general",
      strengthName: body.strength || "medium",
      providerId: body.llmProvider || undefined,
    });

    if (!polished.ok) {
      return send(res, 200, {
        ...local,
        llmError: polished.error,
        meta: { ...local.meta, mode: "local", llmAttempted: true },
      });
    }

    const improved = polished.improved;
    const exported = exportForTool(improved, body.tool || body.profile || "generic", {
      title: "Improved prompt",
    });

    return send(res, 200, {
      ok: true,
      improved,
      text: exported.text,
      hint: exported.hint,
      original: local.original,
      localDraft: local.improved,
      meta: {
        ...local.meta,
        mode: "llm",
        llmProvider: polished.provider,
        llmProviderName: polished.providerName,
        llmModel: polished.model,
        charCount: {
          in: local.original.length,
          out: improved.length,
        },
        wordCount: {
          in: local.original.split(/\s+/).filter(Boolean).length,
          out: improved.split(/\s+/).filter(Boolean).length,
        },
      },
    });
  }

  return send(res, 404, { ok: false, error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }

    let filePath = safeJoin(
      PUBLIC,
      url.pathname === "/" ? "/index.html" : url.pathname
    );
    if (!filePath) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC, "index.html");
    }

    const ext = path.extname(filePath);
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    send(res, 500, { ok: false, error: err.message || "Server error" });
  }
});

// Avoid double-listen when imported from CLI
if (!server.listening) {
  server.listen(PORT, HOST, () => {
    const llm = detectLlmConfig();
    const idx = libraryIndex();
    console.log(`\n  Prompter is live (local only)`);
    console.log(`  → http://${HOST}:${PORT}`);
    console.log(`  Library: ${idx.count.templates} templates · ${idx.count.patterns} patterns`);
    console.log(
      llm.available
        ? `  Extra AI rewrite: ${llm.name} (${llm.model})`
        : `  Extra AI rewrite: off`
    );
    console.log(`  Leave this window open. Close it to stop.\n`);
  });
}

export { server };
