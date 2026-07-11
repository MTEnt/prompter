/**
 * Immutable secret-path checks (cannot be negated by project gitignore).
 */

import path from "node:path";
import { compileMany, pathMatchesIgnore } from "./gitignore.js";
import { SECURITY_DENY } from "./defaults.js";

const securityRules = compileMany(SECURITY_DENY);

const SENSITIVE_ROOT_NAMES = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".config",
]);

/**
 * @param {string} relPath
 * @param {boolean} isDir
 */
export function isSecurityDenied(relPath, isDir = false) {
  const norm = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
  if (!norm) return false;
  if (pathMatchesIgnore(norm, isDir, securityRules)) return true;
  const base = path.posix.basename(norm);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  if (/^id_(rsa|ed25519|dsa)(\.|$)/i.test(base)) return true;
  // never pack known secret home dirs if someone attaches ~ 
  const first = norm.split("/")[0];
  if (SENSITIVE_ROOT_NAMES.has(first)) return true;
  return false;
}

/**
 * Refuse attaching clearly sensitive absolute roots.
 * @param {string} absPath
 */
export function isForbiddenAttachRoot(absPath) {
  const n = path.resolve(absPath).replace(/\\/g, "/");
  const home = (process.env.HOME || process.env.USERPROFILE || "").replace(/\\/g, "/");
  const bannedPrefixes = [
    "/etc",
    "/private/etc",
    "/System",
    "/Library",
    "/bin",
    "/sbin",
    "/usr",
    "/var",
    "/private/var",
    "/tmp",
    "/private/tmp",
    "/dev",
    "/proc",
    "/Windows",
    "/Program Files",
    "/Program Files (x86)",
  ];
  if (n === "/") return true;
  if (bannedPrefixes.some((p) => n === p || n.startsWith(p + "/"))) return true;
  if (home) {
    const sensitive = [".ssh", ".aws", ".gnupg", ".kube", ".config", ".docker"].map(
      (s) => `${home}/${s}`
    );
    if (sensitive.some((s) => n === s || n.startsWith(s + "/"))) return true;
  }
  return false;
}
