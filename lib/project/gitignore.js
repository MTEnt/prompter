/**
 * Minimal gitignore-style matcher (local, no deps).
 * Supports *, **, ?, trailing slash dirs, and ! negation (basic).
 */

import path from "node:path";

/**
 * @param {string} pattern
 * @returns {{ neg: boolean, dirOnly: boolean, re: RegExp, raw: string }}
 */
export function compilePattern(pattern) {
  let raw = pattern.trim();
  if (!raw || raw.startsWith("#")) return null;

  let neg = false;
  if (raw.startsWith("!")) {
    neg = true;
    raw = raw.slice(1);
  }

  // strip leading ./
  if (raw.startsWith("./")) raw = raw.slice(2);

  let dirOnly = false;
  if (raw.endsWith("/")) {
    dirOnly = true;
    raw = raw.slice(0, -1);
  }

  // If no slash in middle, match in any directory
  const anchored = raw.startsWith("/");
  if (anchored) raw = raw.slice(1);
  const anyDir = !raw.includes("/");

  let src = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "*" && raw[i + 1] === "*") {
      // **
      if (raw[i + 2] === "/") {
        src += "(?:.*/)?";
        i += 2;
      } else {
        src += ".*";
        i += 1;
      }
    } else if (c === "*") {
      src += "[^/]*";
    } else if (c === "?") {
      src += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      src += "\\" + c;
    } else {
      src += c;
    }
  }

  let body = src;
  if (anyDir && !anchored) {
    body = `(?:.*/)?${src}`;
  }

  const re = new RegExp(`^${body}$`);
  return { neg, dirOnly, re, raw: pattern.trim() };
}

/**
 * @param {string[]} lines
 * @returns {ReturnType<typeof compilePattern>[]}
 */
export function compileMany(lines) {
  return lines.map(compilePattern).filter(Boolean);
}

/**
 * @param {string} relPath posix-ish relative path
 * @param {boolean} isDir
 * @param {ReturnType<typeof compilePattern>[]} rules
 */
export function isIgnored(relPath, isDir, rules) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  let ignored = false;

  for (const rule of rules) {
    if (!rule) continue;
    if (rule.dirOnly && !isDir) {
      // also match if any parent path segment is this dir pattern for children
      // handled by walking parent dirs separately
    }
    const hit = rule.re.test(norm);
    if (!hit && rule.dirOnly) {
      // path under an ignored directory: "foo/" ignores "foo/bar"
      if (rule.re.test(norm.split("/")[0]) && norm.includes("/")) {
        // not general enough; try prefix
      }
    }
    if (hit) {
      ignored = !rule.neg;
    } else if (rule.dirOnly) {
      // Match directory prefix: pattern "build" / "build/" ignores build/**
      const asDir = norm + (isDir ? "" : "");
      // Check if any path prefix matches
      const parts = norm.split("/");
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        acc = i === 0 ? parts[0] : acc + "/" + parts[i];
        if (rule.re.test(acc) && (isDir || i < parts.length - 1 || rule.dirOnly)) {
          if (i < parts.length - 1 || isDir) {
            ignored = !rule.neg;
          }
        }
      }
    }
  }

  return ignored;
}

/**
 * Simpler, reliable matcher used by the walker.
 * @param {string} relPath
 * @param {boolean} isDir
 * @param {Array<{neg:boolean,dirOnly:boolean,re:RegExp}>} rules
 */
export function pathMatchesIgnore(relPath, isDir, rules) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  let ignored = false;

  for (const rule of rules) {
    if (!rule) continue;

    const candidates = [norm];
    // also test each parent path for directory patterns
    const parts = norm.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - (isDir ? 0 : 1); i++) {
      acc = i === 0 ? parts[0] : `${acc}/${parts[i]}`;
      candidates.push(acc);
    }

    let hit = false;
    for (const c of candidates) {
      if (rule.re.test(c)) {
        // dirOnly rules only apply to dirs or children under them
        if (rule.dirOnly) {
          if (c === norm && !isDir && !norm.endsWith("/")) {
            // exact file named like dir pattern — allow match as path
            hit = true;
          } else if (norm === c || norm.startsWith(c + "/")) {
            hit = true;
          }
        } else {
          hit = true;
        }
        if (hit) break;
      }
    }

    // children of ignored dirs
    if (!hit && rule.dirOnly) {
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.slice(0, i + 1).join("/");
        if (rule.re.test(prefix) && norm.startsWith(prefix + "/")) {
          hit = true;
          break;
        }
      }
    }

    if (hit) ignored = !rule.neg;
  }

  return ignored;
}

/**
 * @param {string} root
 * @param {import('node:fs').promises} fs
 */
export async function loadGitignoreFiles(root, fs) {
  const files = [".gitignore", ".canopyignore"];
  const lines = [];
  for (const name of files) {
    const p = path.join(root, name);
    try {
      const text = await fs.readFile(p, "utf8");
      lines.push(...text.split(/\r?\n/));
    } catch {
      // missing is fine
    }
  }
  return lines;
}
