/**
 * Local secret scrubbing — never leaves the machine.
 * Redacts common key shapes before packing.
 */

const PATTERNS = [
  {
    name: "aws-access-key",
    re: /\b(AKIA[0-9A-Z]{16})\b/g,
    replace: "AKIA****************",
  },
  {
    name: "github-pat",
    re: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
    replace: "ghp_****************",
  },
  {
    name: "generic-api-key-assign",
    re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client_secret)\b(\s*[=:]\s*)(["']?)([^\s"'\\]{12,})(["']?)/gi,
    replace: (_m, k, mid, q1, _v, q2) => `${k}${mid}${q1}***REDACTED***${q2 || q1 || ""}`,
  },
  {
    name: "bearer",
    re: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    replace: "$1***REDACTED***",
  },
  {
    name: "private-key-block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replace: "-----BEGIN PRIVATE KEY-----***REDACTED***-----END PRIVATE KEY-----",
  },
  {
    name: "slack-token",
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replace: "xox*-***REDACTED***",
  },
  {
    name: "openai-ish-key",
    re: /\b(sk-[A-Za-z0-9]{20,})\b/g,
    replace: "sk-***REDACTED***",
  },
];

/**
 * @param {string} text
 * @returns {{ text: string, hits: string[] }}
 */
export function scrubSecrets(text) {
  let out = text;
  const hits = [];
  for (const p of PATTERNS) {
    if (typeof p.replace === "function") {
      const before = out;
      out = out.replace(p.re, p.replace);
      if (out !== before) hits.push(p.name);
    } else {
      const before = out;
      out = out.replace(p.re, p.replace);
      if (out !== before) hits.push(p.name);
    }
  }
  return { text: out, hits: [...new Set(hits)] };
}
