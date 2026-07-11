import { spawn } from "node:child_process";
import os from "node:os";

/** Native folder picker for noobs — no terminal path typing. */
export function pickFolderNative() {
  const plat = process.platform;
  return new Promise((resolve, reject) => {
    if (plat === "darwin") {
      const script =
        'try\n' +
        '  set p to POSIX path of (choose folder with prompt "Choose your project folder")\n' +
        '  return p\n' +
        'on error\n' +
        '  return ""\n' +
        'end try';
      const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", () => {
        const p = out.trim();
        if (!p) return resolve(null);
        resolve(p.endsWith("/") ? p.slice(0, -1) : p);
      });
      return;
    }

    if (plat === "win32") {
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        '$d.Description = "Choose your project folder"',
        "$d.ShowNewFolderButton = $false",
        "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath } else { '' }",
      ].join("; ");
      const child = spawn("powershell", ["-NoProfile", "-STA", "-Command", ps], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim() || null));
      return;
    }

    const tryZenity = spawn(
      "zenity",
      ["--file-selection", "--directory", "--title=Choose your project folder"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    tryZenity.stdout.on("data", (d) => (out += d));
    tryZenity.on("error", () => {
      const kd = spawn("kdialog", ["--getexistingdirectory", os.homedir()], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let kout = "";
      kd.stdout.on("data", (d) => (kout += d));
      kd.on("close", () => resolve(kout.trim() || null));
      kd.on("error", () => reject(new Error("No folder picker on this system")));
    });
    tryZenity.on("close", (code) => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else resolve(null);
    });
  });
}
