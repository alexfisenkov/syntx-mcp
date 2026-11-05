import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { deploymentError, DEPLOY_NGINX, DEPLOY_UNIT, renderDeploymentPlan } from "./private-owner-plan.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function run(file, args) { return execFileSync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
export function currentTarget(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || (stat.mode & 0o022)) deploymentError("DEPLOY_TARGET_UNSAFE");
    return { sha256: sha256(readFileSync(path)), uid: stat.uid, mode: stat.mode & 0o777 };
  } catch (error) { if (error.code === "ENOENT") return { sha256: "absent" }; throw error; }
}
export function assertTargetCAS(path, expected) { if (currentTarget(path).sha256 !== expected) deploymentError("DEPLOY_TARGET_CHANGED"); }
function canonicalOwnedDirectory(path, uid = 0, mode) {
  const stat = lstatSync(path);
  if (realpathSync(path) !== path || !stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022) || mode !== undefined && (stat.mode & 0o777) !== mode) deploymentError("DEPLOY_DIRECTORY_UNSAFE");
}
function immutableAncestors(path) {
  for (let current = dirname(path); ; current = dirname(current)) {
    canonicalOwnedDirectory(current);
    if (current === "/") return;
  }
}
function optionalDirectory(path, uid, mode) { try { canonicalOwnedDirectory(path, uid, mode); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
function activeUnit() { try { run("systemctl", ["is-active", "--quiet", "syntx-mcp-https.service"]); return true; } catch (error) { if ([3, 4].includes(error.status)) return false; throw error; } }
function enabledUnit() { try { return run("systemctl", ["is-enabled", "syntx-mcp-https.service"]) === "enabled"; } catch { return false; } }
function serviceAccount(user) {
  try {
    const fields = run("getent", ["passwd", user]).split(":");
    if (fields.length !== 7 || fields[0] !== user || fields[5] !== `/var/lib/${user}` || !["/usr/sbin/nologin", "/sbin/nologin"].includes(fields[6])) deploymentError("DEPLOY_EXISTING_USER_UNEXPECTED");
    return { uid: Number(fields[2]), gid: Number(fields[3]) };
  } catch (error) { if (error.status === 2) return undefined; throw error; }
}
function verifyReleaseTree(directory) {
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.uid !== 0) deploymentError("DEPLOY_RELEASE_WRITABLE_OR_NOT_ROOT_OWNED");
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path), child = relative(directory, target);
      if (child === ".." || child.startsWith(`..${sep}`)) deploymentError("DEPLOY_RELEASE_SYMLINK_ESCAPES");
    } else {
      if (stat.mode & 0o022) deploymentError("DEPLOY_RELEASE_WRITABLE_OR_NOT_ROOT_OWNED");
      if (stat.isDirectory()) for (const name of readdirSync(path)) { if (path === directory && name === ".git") continue; visit(join(path, name)); }
      else if (!stat.isFile()) deploymentError("DEPLOY_RELEASE_SPECIAL_FILE");
    }
  };
  visit(directory);
}

/** Read-only, no package downloads, no providers, no system changes. All checks run before the first write. */
export async function preflightDeployment(options) {
  if (process.platform !== "linux") deploymentError("DEPLOY_REQUIRES_LINUX");
  for (const path of [options.release, options.node, options.ffmpeg, options.ffprobe, options.vhost]) {
    if (realpathSync(path) !== path || /^\/(?:root|home)\//u.test(path)) deploymentError("DEPLOY_NONCANONICAL_OR_PROTECTED_HOME_PATH");
    immutableAncestors(path);
  }
  for (const path of [options.node, options.ffmpeg, options.ffprobe]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || !(stat.mode & 0o111)) deploymentError("DEPLOY_EXECUTABLE_UNSAFE");
  }
  if (!/^v24\.21\.[0-9]+$/u.test(run(options.node, ["--version"]))) deploymentError("DEPLOY_NODE_24_21_REQUIRED");
  if (!run(options.ffmpeg, ["-version"]).startsWith("ffmpeg version ") || !run(options.ffprobe, ["-version"]).startsWith("ffprobe version ")) deploymentError("DEPLOY_MEDIA_BINARY_INVALID");
  for (const path of ["/etc/systemd/system", dirname(DEPLOY_NGINX), "/var/lib", "/var/backups"]) canonicalOwnedDirectory(path);
  const vhost = currentTarget(options.vhost);
  if (vhost.uid !== 0 || vhost.sha256 !== options.expectedVhostSha256) deploymentError("DEPLOY_VHOST_CHANGED");
  const source = readFileSync(options.vhost, "utf8").replace(/#.*$/gmu, "");
  if (!source.includes("include /etc/nginx/masterskaya-mcp-cloud/*.conf;") ||
      !source.split(";").some((part) => /\bserver_name\s/u.test(part) && part.trim().split(/\s+/u).includes(options.domain))) deploymentError("DEPLOY_VHOST_NAMESPACE_NOT_CONFIRMED");
  run("nginx", ["-t"]);
  if (run("git", ["-C", options.release, "rev-parse", "HEAD"]) !== options.expectedCommit ||
      run("git", ["-C", options.release, "status", "--porcelain", "--untracked-files=no"])) deploymentError("DEPLOY_RELEASE_COMMIT_OR_DIRTY_MISMATCH");
  const remote = run("git", ["-C", options.release, "remote", "get-url", "origin"]);
  if (!["https://github.com/alexfisenkov/syntx-mcp.git", "git@github.com:alexfisenkov/syntx-mcp.git"].includes(remote)) deploymentError("DEPLOY_PUBLIC_REPOSITORY_REQUIRED");
  if (JSON.parse(readFileSync(join(options.release, "package.json"), "utf8")).name !== "syntx-mcp") deploymentError("DEPLOY_PACKAGE_INVALID");
  verifyReleaseTree(options.release);
  // Public-source manifest performs its own bounded path/hash validation; no key/profile is in that release.
  const { loadAndVerifyPublicSourceManifest } = await import(pathToFileURL(join(options.release, "scripts/public-source-package-manifest.mjs")).href);
  await loadAndVerifyPublicSourceManifest(options.release);
  for (const name of ["dist/src/transports/https-owner.js", "dist/src/transports/stdio-owner.js", "dist/src/transports/owner-stdio-buffer.js"]) if (!lstatSync(join(options.release, name)).isFile()) deploymentError("DEPLOY_BUILT_ENTRY_MISSING");
  const { buildMediaMcpConfig } = await import(pathToFileURL(join(options.release, "scripts/print-media-mcp-config.mjs")).href);
  const environment = { ...buildMediaMcpConfig(pathToFileURL(join(options.release, "scripts/print-media-mcp-config.mjs")).href, options.node, { includeAllSupportedMedia: true }).mcpServers.syntx.env };
  for (const [key, value] of Object.entries(environment)) {
    if (key.endsWith("_FFPROBE_PATH")) environment[key] = options.ffprobe;
    else if (key.endsWith("_FFMPEG_PATH")) environment[key] = options.ffmpeg;
    else if (/^<.*>$/u.test(value) && key.endsWith("_UPLOAD_DESTINATION")) environment[key] = options.uploadDestination;
  }
  const plan = renderDeploymentPlan(options, environment);
  const account = serviceAccount(options.user);
  if (!account && optionalDirectory(plan.state, 0, 0o700)) deploymentError("DEPLOY_STATE_EXISTS_WITHOUT_SERVICE_USER");
  if (account) {
    optionalDirectory(plan.state, account.uid, 0o700);
    for (const child of ["owner-profile", "oauth-state"]) optionalDirectory(join(plan.state, child), account.uid, 0o700);
    try {
      const keyPath = join(plan.state, "auth.key"), key = lstatSync(keyPath);
      if (!key.isFile() || key.isSymbolicLink() || key.nlink !== 1 || key.uid !== account.uid || (key.mode & 0o777) !== 0o600 || key.size !== 32) deploymentError("DEPLOY_EXISTING_KEY_UNSAFE");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const targets = [
    { path: DEPLOY_UNIT, expected: options.expectedUnitSha256, content: plan.unit, mode: 0o644, owner: "root" },
    { path: DEPLOY_NGINX, expected: options.expectedNginxSha256, content: plan.nginx, mode: 0o644, owner: "root" },
    { path: plan.configPath, expected: options.expectedConfigSha256, content: `${JSON.stringify(plan.config, null, 2)}\n`, mode: 0o600, owner: options.user }
  ];
  for (const target of targets) {
    assertTargetCAS(target.path, target.expected);
    const existing = currentTarget(target.path);
    if (existing.sha256 !== "absent" && (existing.uid !== (target.owner === "root" ? 0 : account?.uid) || existing.mode !== target.mode)) deploymentError("DEPLOY_EXISTING_TARGET_OWNER_OR_MODE_INVALID");
  }
  const active = activeUnit();
  if (active && options.apply && !options.acknowledgeRuntimeRestart) deploymentError("DEPLOY_RESTART_ACK_REQUIRED_RECONCILE_UNKNOWN_WORK_FIRST");
  const listening = run("ss", ["-H", "-ltnp", `sport = :${options.port}`]);
  if (listening) {
    const pid = active ? run("systemctl", ["show", "--property=MainPID", "--value", "syntx-mcp-https.service"]) : "";
    if (!pid || !listening.includes(`pid=${pid},`)) deploymentError("DEPLOY_PORT_ALREADY_OWNED_BY_ANOTHER_PROCESS");
  }
  return { plan, targets, account, active, enabled: enabledUnit(), vhostSha256: vhost.sha256 };
}
