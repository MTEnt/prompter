/**
 * Structure-first view: keep imports, types, signatures; drop heavy bodies.
 * Heuristic (language-agnostic-ish). Pure local string work.
 */

const LANG = {
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".ts": "ts",
  ".tsx": "ts",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java",
  ".kt": "kt",
  ".rb": "rb",
  ".php": "php",
  ".swift": "swift",
  ".cs": "cs",
};

/**
 * @param {string} rel
 * @param {string} text
 */
export function structureOnly(rel, text) {
  const ext = rel.includes(".") ? "." + rel.split(".").pop().toLowerCase() : "";
  const kind = LANG[ext];
  if (!kind) {
    // non-code: keep small files fully, trim large
    if (text.length < 4000) return text;
    return text.slice(0, 2000) + "\n… [truncated for structure mode]\n";
  }

  const lines = text.split(/\r?\n/);
  const out = [];
  let braceDepth = 0;
  let skippingBody = false;
  let bodyStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Always keep imports / package / use / from
    if (
      /^(import|export\s+(type\s+)?\{?|from\s|package\s|using\s|require\(|#include|use\s|from\s+\S+\s+import)/.test(
        trimmed
      ) ||
      /^(const|let|var)\s+\w+\s*=\s*require\(/.test(trimmed)
    ) {
      out.push(line);
      continue;
    }

    // Type / interface / class headers
    if (
      /^(export\s+)?(default\s+)?(async\s+)?(function\*?|class|interface|type|enum|struct|impl|trait|fn|def|pub\s+fn|func|public\s+class|private\s+class)/.test(
        trimmed
      ) ||
      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed) ||
      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*async\s+function/.test(trimmed)
    ) {
      out.push(line);
      // if line ends with { start body skip
      const open = (line.match(/\{/g) || []).length;
      const close = (line.match(/\}/g) || []).length;
      braceDepth += open - close;
      if (open > close && !trimmed.endsWith(";") && !trimmed.endsWith(",")) {
        skippingBody = true;
        bodyStartDepth = braceDepth - (open - close);
        // actually body starts after this line's opens
        bodyStartDepth = braceDepth;
        if (!trimmed.includes("{")) {
          // next lines may open brace
        } else {
          out.push(indentOf(line) + "  …");
        }
      }
      continue;
    }

    if (skippingBody) {
      const open = (line.match(/\{/g) || []).length;
      const close = (line.match(/\}/g) || []).length;
      braceDepth += open - close;
      if (braceDepth <= bodyStartDepth - 0 && close > 0) {
        // closed the function/class
        if (trimmed === "}" || trimmed.startsWith("}")) {
          out.push(line);
        } else {
          out.push(indentOf(line) + "}");
        }
        skippingBody = false;
      }
      continue;
    }

    // keep top-level-ish short lines (exports, annotations)
    if (
      trimmed.startsWith("@") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("export ") ||
      trimmed === "" ||
      /^(module\.exports|exports\.)/.test(trimmed)
    ) {
      out.push(line);
      continue;
    }

    // keep one-line declarations without big braces
    if (!trimmed.includes("{") && trimmed.length < 160) {
      if (
        /^(export\s+)?(const|let|var|type|interface|enum|class|function|async function|def |fn |pub |func )/.test(
          trimmed
        )
      ) {
        out.push(line);
      }
    }
  }

  const result = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return result.trimEnd() + "\n";
}

function indentOf(line) {
  const m = line.match(/^\s*/);
  return m ? m[0] : "";
}
