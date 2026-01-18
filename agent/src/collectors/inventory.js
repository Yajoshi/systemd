import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

async function safeRead(path) {
  try {
    return (await fs.readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

async function run(cmd, args = [], timeoutMs = 15000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });
    return { ok: true, out: (stdout || "").trim(), err: (stderr || "").trim(), cmd: `${cmd} ${args.join(" ")}` };
  } catch (e) {
    return {
      ok: false,
      out: (e.stdout || "").toString().trim(),
      err: (e.stderr || e.message || "").toString().trim(),
      cmd: `${cmd} ${args.join(" ")}`
    };
  }
}

function tryJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function collectInventory() {
  const hostname = await safeRead("/etc/hostname");
  const kernel = await safeRead("/proc/version");

  // Proxy
  const env = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  const etcEnvironment = await safeRead("/etc/environment");
  const aptProxy = await safeRead("/etc/apt/apt.conf.d/95edgeonboard-proxy");

  // LAN
  const ipAddr = await run("ip", ["-j", "addr"]);
  const ipRoute = await run("ip", ["-j", "route"]);
  const resolvectl = await run("resolvectl", ["status"], 15000);
  const resolvConf = await safeRead("/etc/resolv.conf");

  // VM details
  const virt = await run("systemd-detect-virt", ["-v"], 5000);
  const dmiVendor = await safeRead("/sys/class/dmi/id/sys_vendor");
  const dmiProduct = await safeRead("/sys/class/dmi/id/product_name");

  // LXD
  const lxdNetworks = await run("lxc", ["network", "list", "--format", "json"], 15000);
  const lxdInstances = await run("lxc", ["list", "--format", "json"], 15000);

  // MicroK8s
  const microk8sStatus = await run("microk8s", ["status"], 30000);

  return {
    timestamp: new Date().toISOString(),
    hostname,
    kernel,
    proxy: {
      env,
      files: {
        "/etc/environment": etcEnvironment,
        "/etc/apt/apt.conf.d/95edgeonboard-proxy": aptProxy
      }
    },
    lan: {
      ipAddr: tryJson(ipAddr.out) || ipAddr.out,
      ipRoute: tryJson(ipRoute.out) || ipRoute.out,
      dns: {
        resolvectl: resolvectl.ok ? resolvectl.out : resolvectl.err,
        resolvConf
      }
    },
    vm: {
      virtualization: virt.ok ? virt.out : virt.err,
      dmi: { vendor: dmiVendor, product: dmiProduct }
    },
    lxd: {
      networks: lxdNetworks.ok ? tryJson(lxdNetworks.out) : lxdNetworks.err,
      instances: lxdInstances.ok ? tryJson(lxdInstances.out) : lxdInstances.err
    },
    microk8s: {
      status: microk8sStatus.ok ? microk8sStatus.out : microk8sStatus.err
    }
  };
}
