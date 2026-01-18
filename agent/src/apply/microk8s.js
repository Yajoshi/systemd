import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(cmd, args = [], timeoutMs = 60000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });
    return { ok: true, out: (stdout || "").trim(), err: (stderr || "").trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim(), err: (e.stderr || e.message || "").toString().trim() };
  }
}

export async function applyMicrok8sAddons(body) {
  const enable = body?.enable || [];
  const disable = body?.disable || [];
  if (!Array.isArray(enable) || !Array.isArray(disable)) throw new Error("enable/disable must be arrays");

  const results = { enable: [], disable: [], status: null };

  for (const a of enable) {
    const r = await run("microk8s", ["enable", String(a)], 600000);
    results.enable.push({ addon: String(a), ok: r.ok, out: r.out, err: r.err });
  }
  for (const a of disable) {
    const r = await run("microk8s", ["disable", String(a)], 600000);
    results.disable.push({ addon: String(a), ok: r.ok, out: r.out, err: r.err });
  }

  const st = await run("microk8s", ["status", "--wait-ready"], 300000);
  results.status = st.ok ? st.out : st.err;

  return results;
}
