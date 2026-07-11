import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Resolve GitHub-ish refs to a clone URL + optional ref.
 * All work stays on this machine via local `git`.
 *
 * @param {string} remote
 * @returns {{ url: string, ref?: string, label: string }}
 */
export function parseRemote(remote) {
  let s = remote.trim();

  // owner/repo
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) {
    return {
      url: `https://github.com/${s}.git`,
      label: s,
    };
  }

  // https://github.com/owner/repo[/tree/ref|/commit/sha]
  const m = s.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(?:tree|commit)\/([^/#?]+))?(?:\/.*)?$/i
  );
  if (m) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "");
    return {
      url: `https://github.com/${owner}/${repo}.git`,
      ref: m[3],
      label: `${owner}/${repo}`,
    };
  }

  // git@github.com:owner/repo.git
  const ssh = s.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) {
    return {
      url: `git@github.com:${ssh[1]}/${ssh[2].replace(/\.git$/, "")}.git`,
      label: `${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`,
    };
  }

  // generic git URL
  if (s.endsWith(".git") || s.startsWith("git@") || s.includes("://")) {
    return { url: s, label: s };
  }

  throw new Error(
    `Unrecognized remote: ${remote}\nUse owner/repo, a GitHub URL, or any git clone URL.`
  );
}

/**
 * Shallow-clone into a temp directory. Caller should cleanup.
 * @param {string} remote
 * @param {{ ref?: string, quiet?: boolean }} [opts]
 */
export async function cloneRemote(remote, opts = {}) {
  const parsed = parseRemote(remote);
  const ref = opts.ref || parsed.ref;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "canopy-"));

  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(parsed.url, tmp);

  await runGit(args, { quiet: opts.quiet });

  return {
    dir: tmp,
    label: parsed.label + (ref ? `@${ref}` : ""),
    cleanup: async () => {
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

function runGit(args, { quiet } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"],
    });
    let err = "";
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        err += d.toString();
      });
    }
    child.on("error", (e) => {
      if (e.code === "ENOENT") {
        reject(new Error("git not found. Install git to load remote repos."));
      } else reject(e);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args[0]} failed (${code}): ${err.trim() || "unknown error"}`));
    });
  });
}
