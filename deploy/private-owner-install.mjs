#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, chmodSync, chownSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseDeploymentArguments, deploymentError, DEPLOY_BACKUPS, DEPLOY_NGINX, DEPLOY_UNIT, SERVICE_NAME } from "./private-owner-plan.mjs";
import { preflightDeployment, run, sha256, currentTarget, assertTargetCAS } from "./private-owner-preflight.mjs";

function secureDirectory(path, uid, gid) {
  try { mkdirSync(path, { mode: 0o700 }); chownSync(path, uid, gid); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) deploymentError("DEPLOY_DIRECTORY_UNSAFE");
}
export function atomicDeployWrite(path, content, mode, uid, gid, expected) {
  assertTargetCAS(path, expected);
  const temporary = join(dirname(path), `.syntx-write-${randomBytes(12).toString("hex")}`);
  const fd = openSync(temporary, "wx", mode);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    chownSync(temporary, uid, gid); chmodSync(temporary, mode);
    assertTargetCAS(path, expected); renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
function writeReceipt(directory, receipt) {
  const path = join(directory, "receipt.json");
  atomicDeployWrite(path, `${JSON.stringify(receipt, null, 2)}\n`, 0o600, 0, 0, currentTarget(path).sha256);
}
function serviceIdentity(user) { return { uid: Number(run("id", ["-u", user])), gid: Number(run("id", ["-g", user])) }; }
function restoreReceiptFiles(directory, receipt) {
  for (const target of [...receipt.targets].reverse()) {
    const current = currentTarget(target.path).sha256;
    if (current === target.before) continue;
    if (current !== target.installed) deploymentError("DEPLOY_ROLLBACK_CAS_CONFLICT");
    if (target.before === "absent") unlinkSync(target.path);
    else {
      const bytes = readFileSync(join(directory, target.backup));
      if (sha256(bytes) !== target.before) deploymentError("DEPLOY_BACKUP_HASH_MISMATCH");
      atomicDeployWrite(target.path, bytes, target.mode, target.uid, target.gid, target.installed);
    }
  }
}
/** Elapsed-time readiness budget also covers fast ECONNREFUSED before eager CLI warm-up binds. */
export async function verifyLoopbackHealth(plan, controls = {}) {
  const now = controls.now ?? (() => performance.now());
  const request = controls.fetch ?? fetch;
  const sleep = controls.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutSignal = controls.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms));
  const deadline = now() + 45_000;
  const signal = () => {
    const remaining = deadline - now();
    if (remaining <= 0) deploymentError("DEPLOY_LOOPBACK_HEALTH_OR_AUTH_FAILED");
    return timeoutSignal(Math.max(1, Math.min(1000, Math.ceil(remaining))));
  };
  while (now() < deadline) {
    try {
      const response = await request(`http://127.0.0.1:${plan.config.port}${plan.config.basePath}/health`, { signal: signal() });
      const result = await response.json();
      if (response.status === 200 && result.surface === "private-owner" && result.status === "ok") {
        const protectedResponse = await request(`http://127.0.0.1:${plan.config.port}${plan.config.basePath}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: signal() });
        const expected = `${plan.publicOrigin}/.well-known/oauth-protected-resource${plan.config.basePath}/mcp`;
        if (protectedResponse.status === 401 && protectedResponse.headers.get("www-authenticate")?.includes(expected)) return;
      }
    } catch { /* bounded startup read-back; never retries an upstream operation */ }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(200, remaining));
  }
  deploymentError("DEPLOY_LOOPBACK_HEALTH_OR_AUTH_FAILED");
}

export async function applyDeployment(options, prepared) {
  if (process.getuid?.() !== 0) deploymentError("DEPLOY_APPLY_REQUIRES_ROOT");
  const { plan, targets } = prepared;
  // Final CAS after review/preflight and before even creating directories or key material.
  assertTargetCAS(options.vhost, prepared.vhostSha256);
  for (const target of targets) assertTargetCAS(target.path, target.expected);
  secureDirectory(DEPLOY_BACKUPS, 0, 0);
  const backup = join(DEPLOY_BACKUPS, `${new Date().toISOString().replaceAll(/[-:.TZ]/gu, "")}-${randomBytes(6).toString("hex")}`);
  secureDirectory(backup, 0, 0);
  const receipt = { schema_version: 1, phase: "PREPARED", expected_commit: options.expectedCommit, owner_ci_receipt: options.ciRunUrl,
    source_vhost: options.vhost, source_vhost_sha256: prepared.vhostSha256, user: options.user, state: plan.state, was_active: prepared.active, was_enabled: prepared.enabled,
    created_key: false, created_user: false, targets: targets.map((target, index) => {
      const previous = currentTarget(target.path);
      const backupName = `${index}.before`;
      if (previous.sha256 !== "absent") writeFileSync(join(backup, backupName), readFileSync(target.path), { mode: 0o600, flag: "wx" });
      return { path: target.path, before: previous.sha256, installed: sha256(target.content), backup: backupName, mode: target.mode,
        uid: previous.uid ?? 0, gid: previous.sha256 === "absent" ? 0 : lstatSync(target.path).gid };
    }) };
  writeReceipt(backup, receipt);
  console.log(JSON.stringify({ status: "APPLY_PREPARED", rollback_directory: backup, rollback_retains: ["service user", "private OAuth/SYNTX state", "key", "release"] }));
  try {
    if (!prepared.account) { run("useradd", ["--system", "--user-group", "--home-dir", plan.state, "--shell", "/usr/sbin/nologin", options.user]); receipt.created_user = true; }
    const identity = serviceIdentity(options.user);
    secureDirectory(plan.state, identity.uid, identity.gid);
    secureDirectory(plan.config.stateDirectory, identity.uid, identity.gid);
    secureDirectory(plan.config.child.environment.SYNTX_OWNER_AUTH_PROFILE_DIRECTORY, identity.uid, identity.gid);
    const keyPath = plan.config.child.environment.SYNTX_OWNER_AUTH_KEY_FILE;
    let keyExists = false;
    try {
      const key = lstatSync(keyPath);
      if (!key.isFile() || key.isSymbolicLink() || key.nlink !== 1 || key.uid !== identity.uid || key.size !== 32 || (key.mode & 0o777) !== 0o600) deploymentError("DEPLOY_EXISTING_KEY_UNSAFE");
      keyExists = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!keyExists) {
      const key = randomBytes(32);
      try { writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 }); chownSync(keyPath, identity.uid, identity.gid); }
      finally { key.fill(0); }
      receipt.created_key = true;
    }
    writeReceipt(backup, receipt);
    for (const target of targets) {
      const uid = target.owner === "root" ? 0 : identity.uid, gid = target.owner === "root" ? 0 : identity.gid;
      atomicDeployWrite(target.path, target.content, target.mode, uid, gid, target.expected);
    }
    assertTargetCAS(options.vhost, prepared.vhostSha256);
    run("nginx", ["-t"]); run("systemd-analyze", ["verify", DEPLOY_UNIT]);
    receipt.phase = "FILES_VERIFIED"; writeReceipt(backup, receipt);
    run("systemctl", ["daemon-reload"]); run("systemctl", ["enable", SERVICE_NAME]);
    run("systemctl", [prepared.active ? "restart" : "start", SERVICE_NAME]);
    await verifyLoopbackHealth(plan);
    assertTargetCAS(options.vhost, prepared.vhostSha256);
    run("nginx", ["-t"]); run("systemctl", ["reload", "nginx"]);
    receipt.phase = "LOOPBACK_VERIFIED_NGINX_RELOADED"; writeReceipt(backup, receipt);
    console.log(JSON.stringify({ status: receipt.phase, expected_commit: options.expectedCommit, rollback_directory: backup,
      public_acceptance: "NOT_VERIFIED", provider_login: "NOT_PERFORMED", generation: "NOT_PERFORMED" }));
    return backup;
  } catch {
    receipt.phase = "APPLY_FAILED_ROLLBACK_REQUIRED"; writeReceipt(backup, receipt);
    try {
      // Stop only this service. Never touch existing MCP routes/services, private state or key material.
      try { run("systemctl", ["stop", SERVICE_NAME]); } catch { /* may not yet be loaded */ }
      if (!prepared.enabled) { try { run("systemctl", ["disable", SERVICE_NAME]); } catch { /* no prior/new unit may not exist */ } }
      restoreReceiptFiles(backup, receipt);
      run("nginx", ["-t"]); run("systemctl", ["daemon-reload"]);
      if (prepared.active) run("systemctl", ["start", SERVICE_NAME]);
      run("systemctl", ["reload", "nginx"]);
      receipt.phase = "ROLLED_BACK_PRIVATE_STATE_RETAINED"; writeReceipt(backup, receipt);
    } catch { receipt.phase = "ROLLBACK_INCOMPLETE_OPERATOR_REQUIRED"; writeReceipt(backup, receipt); }
    console.error(JSON.stringify({ error: receipt.phase, rollback_directory: backup }));
    deploymentError("DEPLOY_APPLY_FAILED");
  }
}

export function rollbackDeployment(directory, acknowledgeRuntimeRestart) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) deploymentError("DEPLOY_ROLLBACK_REQUIRES_LINUX_ROOT");
  const child = relative(DEPLOY_BACKUPS, directory), stat = lstatSync(directory);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || realpathSync(directory) !== directory || stat.uid !== 0 || (stat.mode & 0o777) !== 0o700) deploymentError("DEPLOY_ROLLBACK_DIRECTORY_UNSAFE");
  const receipt = JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8"));
  const expectedConfig = `/var/lib/${receipt.user}/launch.json`;
  if (receipt.schema_version !== 1 || !/^[a-z][a-z0-9_-]{0,30}$/u.test(receipt.user) ||
      receipt.targets?.length !== 3 || receipt.targets.some((item, i) => item.path !== [DEPLOY_UNIT, DEPLOY_NGINX, expectedConfig][i] || item.backup !== `${i}.before`)) deploymentError("DEPLOY_ROLLBACK_RECEIPT_INVALID");
  if (!acknowledgeRuntimeRestart) deploymentError("DEPLOY_RESTART_ACK_REQUIRED_RECONCILE_UNKNOWN_WORK_FIRST");
  assertTargetCAS(receipt.source_vhost, receipt.source_vhost_sha256);
  run("nginx", ["-t"]);
  for (const target of receipt.targets) {
    const hash = currentTarget(target.path).sha256;
    if (hash !== target.before && hash !== target.installed) deploymentError("DEPLOY_ROLLBACK_CAS_CONFLICT");
  }
  run("systemctl", ["stop", SERVICE_NAME]);
  if (!receipt.was_enabled) run("systemctl", ["disable", SERVICE_NAME]);
  restoreReceiptFiles(directory, receipt); run("nginx", ["-t"]); run("systemctl", ["daemon-reload"]);
  if (receipt.was_active) run("systemctl", ["start", SERVICE_NAME]);
  run("systemctl", ["reload", "nginx"]);
  receipt.phase = "ROLLED_BACK_PRIVATE_STATE_RETAINED"; writeReceipt(directory, receipt);
  console.log(JSON.stringify({ status: receipt.phase, private_state: "RETAINED", service_user: "RETAINED" }));
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      console.log("Read deploy/README.md. Default: read-only Linux preflight/plan. --apply requires exact public commit, owner-provided CI run receipt and target/vhost CAS hashes. --rollback <private-backup-directory> --apply --acknowledge-runtime-restart restores only this namespace/unit/config; private state/key/user stay."); return 0;
    }
    const options = parseDeploymentArguments(argv);
    if (options.rollback) { rollbackDeployment(options.rollback, options.acknowledgeRuntimeRestart); return 0; }
    const prepared = await preflightDeployment(options);
    console.log(JSON.stringify({ status: "PREFLIGHT_PASSED", expected_commit: options.expectedCommit, ci_receipt: options.ciRunUrl ?? "NOT_PROVIDED_PREFLIGHT_ONLY",
      vhost_sha256: prepared.vhostSha256, runtime_active: prepared.active, targets: prepared.targets.map((target) => ({ path: target.path, before_sha256: target.expected, installed_sha256: sha256(target.content) })),
      unit: prepared.plan.unit, nginx: prepared.plan.nginx, config: prepared.plan.config }, null, 2));
    if (options.apply) await applyDeployment(options, prepared);
    return 0;
  } catch (error) { console.error(/^(?:DEPLOY|PUBLIC_MANIFEST)_[A-Z_]+$/u.test(error.message) ? error.message : "DEPLOY_OPERATION_FAILED"); return 1; }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main();
