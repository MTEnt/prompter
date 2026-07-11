/**
 * Optional second-pass polish via OpenAI-compatible chat APIs.
 * Supports OpenAI, xAI (Grok), Anthropic-style is not used here—
 * we stick to OpenAI-compatible endpoints for simplicity.
 */

const PROVIDERS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    envKey: "OPENAI_API_KEY",
    envBase: "OPENAI_BASE_URL",
    envModel: "OPENAI_MODEL",
  },
  xai: {
    name: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    envKey: "XAI_API_KEY",
    envBase: "XAI_BASE_URL",
    envModel: "XAI_MODEL",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    envKey: "OPENROUTER_API_KEY",
    envBase: "OPENROUTER_BASE_URL",
    envModel: "OPENROUTER_MODEL",
  },
  custom: {
    name: "Custom OpenAI-compatible",
    baseUrl: process.env.PROMPTER_LLM_BASE_URL || "http://localhost:11434/v1",
    defaultModel: process.env.PROMPTER_LLM_MODEL || "llama3.2",
    envKey: "PROMPTER_LLM_API_KEY",
    envBase: "PROMPTER_LLM_BASE_URL",
    envModel: "PROMPTER_LLM_MODEL",
  },
};

export function detectLlmConfig() {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const key = process.env[p.envKey];
    if (id === "custom" && process.env.PROMPTER_LLM_BASE_URL) {
      return {
        available: true,
        provider: id,
        name: p.name,
        model: process.env[p.envModel] || p.defaultModel,
        hasKey: Boolean(key || process.env.PROMPTER_LLM_API_KEY === "none"),
      };
    }
    if (key) {
      return {
        available: true,
        provider: id,
        name: p.name,
        model: process.env[p.envModel] || p.defaultModel,
        hasKey: true,
      };
    }
  }
  return { available: false, provider: null, name: null, model: null, hasKey: false };
}

function resolveProvider(preferred) {
  if (preferred && PROVIDERS[preferred]) {
    const p = PROVIDERS[preferred];
    const key = process.env[p.envKey] || (preferred === "custom" ? "none" : "");
    if (key || preferred === "custom") {
      return {
        id: preferred,
        ...p,
        apiKey: key === "none" ? "" : key,
        baseUrl: process.env[p.envBase] || p.baseUrl,
        model: process.env[p.envModel] || p.defaultModel,
      };
    }
  }
  const detected = detectLlmConfig();
  if (!detected.available) return null;
  const p = PROVIDERS[detected.provider];
  return {
    id: detected.provider,
    ...p,
    apiKey: process.env[p.envKey] === "none" ? "" : process.env[p.envKey] || "",
    baseUrl: process.env[p.envBase] || p.baseUrl,
    model: process.env[p.envModel] || p.defaultModel,
  };
}

export async function polishWithLlm({
  original,
  localImproved,
  profileName,
  taskName,
  strengthName,
  providerId,
}) {
  const provider = resolveProvider(providerId);
  if (!provider) {
    return { ok: false, error: "No LLM API configured. Local improve still works." };
  }

  const system = `You are Prompter, an expert prompt engineer. Rewrite prompts so they are maximally effective for coding agents and chat models.

Rules:
- Output ONLY the improved prompt text. No preamble, no markdown fences around the whole answer.
- Preserve the user's real intent; do not change the task into something else.
- Make instructions imperative, specific, and complete.
- Optimize for the target: ${profileName}.
- Task type: ${taskName}. Strength: ${strengthName}.
- Prefer structure (sections) when strength is medium or strong; keep light rewrites concise.
- Include success criteria and constraints when useful.
- Do not add fake file paths the user did not imply.
- English unless the user wrote in another language—then match their language.`;

  const user = `Original prompt:
---
${original}
---

A local structured draft (you may refine or replace while keeping intent):
---
${localImproved}
---

Produce the final improved prompt only.`;

  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3847";
    headers["X-Title"] = "Prompter";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `LLM request failed (${res.status}): ${body.slice(0, 400)}`,
      provider: provider.id,
      model: provider.model,
    };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return { ok: false, error: "LLM returned empty content.", provider: provider.id };
  }

  return {
    ok: true,
    improved: text.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim(),
    provider: provider.id,
    providerName: provider.name,
    model: provider.model,
  };
}
