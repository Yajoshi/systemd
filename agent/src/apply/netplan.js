import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(cmd, args = [], timeoutMs = 20000) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout: (stdout || "").trim(), stderr: (stderr || "").trim() };
}

export function validateNetplanInput(body) {
  const yaml = body?.yaml;
  if (typeof yaml !== "string" || yaml.trim().length < 10) {
    return { ok: false, errors: ["yaml must be a non-empty string"] };
  }
  // very basic safeguard: must include network:
  if (!yaml.includes("network:")) {
    return { ok: false, errors: ["yaml must include 'network:'"] };
  }
  return { ok: true, errors: [], yaml };
}

export async function applyNetplan(body) {
  const v = validateNetplanInput(body);
  if (!v.ok) throw new Error(v.errors.join("; "));

  const path = "/etc/netplan/99-edge-onboard.yaml";
  const tmp = `${path}.tmp`;
  const bak = `/var/lib/edge-onboard/backups/netplan.99-edge-onboard.${Date.now()}.bak`;
  await fs.mkdir("/var/lib/edge-onboard/backups", { recursive: true });

  try { await fs.copyFile(path, bak); } catch {}

  await fs.writeFile(tmp, v.yaml, "utf8");

  // Validate config
  await run("netplan", ["generate"]);

  // Promote and apply
  await fs.rename(tmp, path);
  await run("netplan", ["apply"]);

  // Verify by reading back and checking ip
  const after = await fs.readFile(path, "utf8");
  const ip = await run("ip", ["-br", "addr"], 15000);

  return {
    backup: bak,
    appliedFile: path,
    verify: {
      fileWritten: after.trim() === v.yaml.trim(),
      ipBrief: ip.stdout
    }
  };
}
