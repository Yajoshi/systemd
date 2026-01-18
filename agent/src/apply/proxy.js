import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BLOCK_START = "# BEGIN EDGE-ONBOARD PROXY";
const BLOCK_END = "# END EDGE-ONBOARD PROXY";

function isValidProxyUrl(v) {
  if (v === "" || v == null) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateProxyInput(body) {
  const httpProxy = body?.httpProxy ?? "";
  const httpsProxy = body?.httpsProxy ?? "";
  const noProxy = body?.noProxy ?? "";

  const errors = [];
  if (!isValidProxyUrl(httpProxy)) errors.push("httpProxy must be a valid http/https URL");
  if (!isValidProxyUrl(httpsProxy)) errors.push("httpsProxy must be a valid http/https URL");
  if (typeof noProxy !== "string") errors.push("noProxy must be a string");

  return { ok: errors.length === 0, errors, candidate: { httpProxy, httpsProxy, noProxy } };
}

async function run(cmd, args = []) {
  await execFileAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024 });
}

function buildEnvBlock({ httpProxy, httpsProxy, noProxy }) {
  const lines = [
    BLOCK_START,
    `HTTP_PROXY="${httpProxy}"`,
    `HTTPS_PROXY="${httpsProxy}"`,
    `NO_PROXY="${noProxy}"`,
    `http_proxy="${httpProxy}"`,
    `https_proxy="${httpsProxy}"`,
    `no_proxy="${noProxy}"`,
    BLOCK_END
  ];
  return lines.join("\n") + "\n";
}

async function replaceBlock(filePath, newBlock) {
  let content = "";
  try { content = await fs.readFile(filePath, "utf8"); } catch { content = ""; }

  const startIdx = content.indexOf(BLOCK_START);
  const endIdx = content.indexOf(BLOCK_END);

  let updated;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + BLOCK_END.length);
    updated = before.trimEnd() + "\n" + newBlock + after.trimStart();
  } else {
    updated = content.trimEnd() + "\n\n" + newBlock;
  }

  await fs.writeFile(filePath, updated, "utf8");
}

export async function applyProxy(body) {
  const v = validateProxyInput(body);
  if (!v.ok) throw new Error(v.errors.join("; "));

  const { httpProxy, httpsProxy, noProxy } = v.candidate;

  // Backup
  const envPath = "/etc/environment";
  const aptPath = "/etc/apt/apt.conf.d/95edgeonboard-proxy";
  const envBak = `/var/lib/edge-onboard/backups/environment.${Date.now()}.bak`;
  const aptBak = `/var/lib/edge-onboard/backups/95edgeonboard-proxy.${Date.now()}.bak`;
  await fs.mkdir("/var/lib/edge-onboard/backups", { recursive: true });
  try { await fs.copyFile(envPath, envBak); } catch {}
  try { await fs.copyFile(aptPath, aptBak); } catch {}

  // Apply /etc/environment block
  const block = buildEnvBlock({ httpProxy, httpsProxy, noProxy });
  await replaceBlock(envPath, block);

  // Apply apt proxy
  const apt = [
    `Acquire::http::Proxy "${httpProxy}";`,
    `Acquire::https::Proxy "${httpsProxy}";`
  ].join("\n") + "\n";
  await fs.writeFile(aptPath, apt, "utf8");

  // Best-effort snap proxy
  try {
    await run("snap", ["set", "system",
      `proxy.http=${httpProxy}`,
      `proxy.https=${httpsProxy}`,
      `proxy.no-proxy=${noProxy}`
    ]);
  } catch {
    // snap may not exist; ignore
  }

  // Verify
  const envAfter = await fs.readFile(envPath, "utf8");
  const aptAfter = await fs.readFile(aptPath, "utf8");

  const verify = {
    environmentHasBlock: envAfter.includes(BLOCK_START) && envAfter.includes(BLOCK_END),
    aptProxyConfigured: aptAfter.includes("Acquire::http::Proxy") || aptAfter.includes("Acquire::https::Proxy")
  };

  return {
    applied: v.candidate,
    backups: { envBak, aptBak },
    verify
  };
}
