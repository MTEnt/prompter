/**
 * Compose a final agent-ready prompt from:
 *  - user situation text
 *  - a pre-built direction (template + patterns under the hood)
 *  - target tool profile
 */

import { getDirection } from "./directions.js";
import { getTemplate, renderTemplate, loadPatterns, exportForTool } from "./library.js";
import { improvePromptLocal } from "./improver.js";

function patternBodies(patternIds) {
  const all = loadPatterns();
  const byId = new Map(all.map((p) => [p.id, p]));
  const chunks = [];
  for (const id of patternIds || []) {
    const p = byId.get(id);
    if (p) {
      // Drop leading "# Pattern: …" title lines from pattern files
      const body = p.body.replace(/^#\s+Pattern:[^\n]*\n+/i, "").trim();
      chunks.push(`### ${p.title}\n${body}`);
    }
  }
  return chunks;
}

/**
 * Map freeform user text into template variables.
 * Primary var gets the full text; remaining required vars get safe defaults from heuristics.
 */
function variablesFromInput(template, primaryVar, userText) {
  const vars = {};
  const text = userText.trim();
  if (primaryVar) vars[primaryVar] = text;

  for (const v of template.variables || []) {
    if (vars[v.name] != null && String(vars[v.name]).trim() !== "") continue;
    if (v.default) {
      vars[v.name] = v.default;
      continue;
    }
    if (!v.required) continue;

    // Fill other required fields with minimal placeholders derived from user text
    if (v.name === "data_path" && /data\/|\.jsonl|dataset/i.test(text)) {
      const m = text.match(/(\S+\.jsonl|\bdata\/\S+)/);
      vars[v.name] = m ? m[1] : "see user note";
    } else if (v.name === "base_model" && primaryVar === "base_model") {
      vars[v.name] = text;
    } else if (v.name !== primaryVar) {
      vars[v.name] = "(see primary request above)";
    }
  }
  return vars;
}

/**
 * @param {object} opts
 * @param {string} opts.input - user situation / rough text
 * @param {string} [opts.directionId]
 * @param {string} [opts.profileId]
 * @param {string} [opts.extraContext]
 * @param {string} [opts.strengthId] - override
 * @param {boolean} [opts.skipImprove] - return scaffold only
 */
export function composePrompt(opts) {
  const direction = getDirection(opts.directionId || "freeform");
  const input = String(opts.input || "").trim();
  if (!input) {
    return { ok: false, error: "Describe what you need (left box is empty)." };
  }

  const profileId = opts.profileId || "generic";
  const strengthId = opts.strengthId || direction.strength;
  const taskId = direction.task;
  const patterns = patternBodies(direction.patterns);

  let scaffold = "";
  let templateId = null;

  if (direction.templateId) {
    const template = getTemplate(direction.templateId);
    if (!template) {
      return { ok: false, error: `Built-in template missing: ${direction.templateId}` };
    }
    templateId = template.id;
    const vars = variablesFromInput(template, direction.primaryVar, input);
    // Always put full user note into primary
    if (direction.primaryVar) vars[direction.primaryVar] = input;

    // For train direction, try to also parse data path into vars if present
    if (templateId === "lora-sft-plan") {
      const pathMatch = input.match(/(\S+\.jsonl|data\/[^\s,]+)/);
      if (pathMatch) vars.data_path = pathMatch[1];
      else if (!vars.data_path || vars.data_path.startsWith("(")) {
        vars.data_path = "specify path in repo (user mentioned training data in free text)";
      }
      // base_model: first token-ish model name
      const modelMatch = input.match(
        /\b([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[Qq]wen[^\s,]*|[Gg]emma[^\s,]*|[Ll]lama[^\s,]*)/
      );
      if (modelMatch) vars.base_model = modelMatch[1];
      else vars.base_model = input.slice(0, 120);
    }

    const rendered = renderTemplate(template, vars);
    if (!rendered.ok) {
      // Soft-fill missing required with user text
      for (const m of rendered.missing || []) {
        vars[m] = input;
      }
      const retry = renderTemplate(template, vars);
      if (!retry.ok) return { ok: false, error: retry.error };
      scaffold = retry.text;
    } else {
      scaffold = rendered.text;
    }
  } else {
    scaffold = input;
  }

  // Append system-chosen technique guidance (not user-browsed).
  // Full pattern bodies only when a direction template is active; freeform gets short reminders.
  if (patterns.length) {
    if (direction.templateId) {
      scaffold = `${scaffold}\n\n## Built-in working patterns (follow these)\n\n${patterns.join("\n\n")}`;
    } else {
      const names = (direction.patterns || []).join(", ");
      scaffold = `${scaffold}\n\n(Apply where useful: ${names}.)`;
    }
  }

  if (opts.skipImprove) {
    return {
      ok: true,
      improved: scaffold,
      original: input,
      scaffold,
      meta: {
        mode: "scaffold",
        direction: direction.id,
        directionLabel: direction.label,
        templateId,
        patterns: direction.patterns,
        profile: profileId,
        task: taskId,
        strength: strengthId,
      },
    };
  }

  const improved = improvePromptLocal({
    prompt: scaffold,
    profileId,
    taskId,
    strengthId,
    extraContext: opts.extraContext || "",
    // Direction templates are already structured; never re-shell them
    preserveStructure: Boolean(direction.templateId),
  });

  if (!improved.ok) return improved;

  return {
    ok: true,
    improved: improved.improved,
    original: input,
    scaffold,
    meta: {
      ...improved.meta,
      mode: templateId ? "direction+template+local" : "direction+local",
      direction: direction.id,
      directionLabel: direction.label,
      templateId,
      patterns: direction.patterns,
    },
  };
}

export function composeAndExport(opts) {
  const result = composePrompt(opts);
  if (!result.ok) return result;
  const tool = opts.tool || opts.profileId || "generic";
  const exported = exportForTool(result.improved, tool, {
    title: result.meta.directionLabel || "Prompt",
    id: result.meta.direction,
    description: result.meta.directionLabel,
  });
  return {
    ...result,
    text: exported.text,
    hint: exported.hint,
  };
}
