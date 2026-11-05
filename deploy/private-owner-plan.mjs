import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const DEPLOY_UNIT = "/etc/systemd/system/syntx-mcp-https.service";
export const DEPLOY_NGINX = "/etc/nginx/masterskaya-mcp-cloud/syntx-ai.conf";
export const DEPLOY_BACKUPS = "/var/backups/syntx-mcp-https";
export const SERVICE_NAME = "syntx-mcp-https.service";
export const BODY_BYTES = 192 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/u;
export function deploymentError(code) { throw new Error(code); }
export function safeAbsolute(value) {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || /[\x00-\x1f\x7f]/u.test(value)) deploymentError("DEPLOY_PATH_INVALID");
  return value;
}
export function systemdQuote(value) { return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`; }
export function parseDeploymentArguments(argv) {
  const value = { domain: "mcp.example.com", basePath: "/syntx-ai", port: 8860, user: "syntx-mcp", uploadDestination: "uploaded",
    expectedUnitSha256: "absent", expectedNginxSha256: "absent", expectedConfigSha256: "absent", apply: false, acknowledgeRuntimeRestart: false };
  const names = { "--release": "release", "--expected-commit": "expectedCommit", "--node": "node", "--ffmpeg": "ffmpeg", "--ffprobe": "ffprobe",
    "--domain": "domain", "--base-path": "basePath", "--port": "port", "--user": "user", "--vhost": "vhost", "--expected-vhost-sha256": "expectedVhostSha256",
    "--expected-unit-sha256": "expectedUnitSha256", "--expected-nginx-sha256": "expectedNginxSha256", "--expected-config-sha256": "expectedConfigSha256",
    "--ci-run-url": "ciRunUrl", "--upload-destination": "uploadDestination", "--rollback": "rollback" };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) deploymentError("DEPLOY_ARGUMENTS_INVALID"); seen.add(flag);
    if (flag === "--apply") value.apply = true;
    else if (flag === "--acknowledge-runtime-restart") value.acknowledgeRuntimeRestart = true;
    else { const name = names[flag], item = argv[++i]; if (!name || !item || item.startsWith("--")) deploymentError("DEPLOY_ARGUMENTS_INVALID"); value[name] = item; }
  }
  if (value.rollback) { safeAbsolute(value.rollback); if (!value.apply) deploymentError("DEPLOY_ROLLBACK_REQUIRES_APPLY"); return value; }
  for (const key of ["release", "node", "ffmpeg", "ffprobe", "vhost"]) safeAbsolute(value[key]);
  if (!/^[a-f0-9]{40}$/u.test(value.expectedCommit) || !SHA.test(value.expectedVhostSha256 ?? "") ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(value.domain) ||
      !/^\/[a-z][a-z0-9_-]{0,47}$/u.test(value.basePath) || !/^[a-z][a-z0-9_-]{0,30}$/u.test(value.user) ||
      !["uploaded", "hidden"].includes(value.uploadDestination)) deploymentError("DEPLOY_ARGUMENTS_INVALID");
  if (!/^[0-9]+$/u.test(String(value.port)) || Number(value.port) < 1024 || Number(value.port) > 65535) deploymentError("DEPLOY_PORT_INVALID");
  value.port = Number(value.port);
  for (const key of ["expectedUnitSha256", "expectedNginxSha256", "expectedConfigSha256"]) if (value[key] !== "absent" && !SHA.test(value[key])) deploymentError("DEPLOY_CAS_HASH_INVALID");
  if (value.apply && !/^https:\/\/github\.com\/alexfisenkov\/syntx-mcp\/actions\/runs\/[0-9]+$/u.test(value.ciRunUrl ?? "")) deploymentError("DEPLOY_OWNER_CI_RECEIPT_REQUIRED");
  return value;
}

function template(name, variables) {
  let value = readFileSync(new URL(`templates/${name}`, import.meta.url), "utf8");
  for (const [key, item] of Object.entries(variables)) value = value.replaceAll(`@@${key}@@`, item);
  if (/@@[A-Z_]+@@/u.test(value)) deploymentError("DEPLOY_TEMPLATE_UNRESOLVED");
  return value;
}
export function renderDeploymentPlan(options, ownerEnvironment) {
  const state = `/var/lib/${options.user}`, configPath = join(state, "launch.json");
  const entry = join(options.release, "dist/src/transports/https-owner.js");
  const publicOrigin = `https://${options.domain}`;
  const environment = { ...ownerEnvironment, SYNTX_OWNER_AUTH_PROFILE_DIRECTORY: join(state, "owner-profile"), SYNTX_OWNER_AUTH_KEY_FILE: join(state, "auth.key"),
    SYNTX_SELF_UPDATE: "0", SYNTX_OWNER_LOCAL_IMAGE_FILES: "0", SYNTX_LOCAL_IMAGE_ROOTS: "[]", SYNTX_STDIO_MAX_BUFFER_BYTES: String(BODY_BYTES) };
  for (const [key, item] of Object.entries(environment)) if (typeof item !== "string" || /^<.*>$/u.test(item) || !/^SYNTX_[A-Z0-9_]+$/u.test(key) || /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/u.test(key)) deploymentError("DEPLOY_CHILD_ENVIRONMENT_INVALID");
  const config = { publicOrigin, basePath: options.basePath, stateDirectory: join(state, "oauth-state"), ownerSubject: `owner-${options.user}`,
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"], allowedOrigins: ["https://chatgpt.com"], allowLoopbackRedirects: false,
    port: options.port, maxBodyBytes: BODY_BYTES, child: { nodeExecutable: options.node, environment } };
  const proxySettings = [
    "    auth_request off;", "    access_log off;", "    error_log /var/log/nginx/syntx-ai-error.log crit;", "    client_max_body_size 192M;",
    "    proxy_buffering off;", "    proxy_intercept_errors off;", "    proxy_pass_request_headers on;", "    proxy_set_header Authorization $http_authorization;",
    "    proxy_cache off;", "    proxy_no_cache 1;", "    proxy_cache_bypass 1;", "    proxy_read_timeout 960s;", "    proxy_send_timeout 960s;",
    "    proxy_http_version 1.1;", '    proxy_set_header Connection "";', `    proxy_set_header Host ${options.domain};`, "    proxy_set_header X-Forwarded-Proto https;",
    ...["X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP", "X-Remote-User", "Remote-User", "X-Authenticated-User", "X-Auth-Request-User", "X-Forwarded-User", "X-Original-URL", "X-Rewrite-URL"].map((header) => `    proxy_set_header ${header} "";`),
    `    proxy_pass http://127.0.0.1:${options.port};`
  ].join("\n");
  return { state, configPath, unitPath: DEPLOY_UNIT, nginxPath: DEPLOY_NGINX, publicOrigin, config,
    unit: template("syntx-mcp-https.service.tpl", { USER: options.user, RELEASE_QUOTED: systemdQuote(options.release), CONFIG_ENV_QUOTED: systemdQuote(`SYNTX_HTTPS_CONFIG_FILE=${configPath}`),
      NODE_QUOTED: systemdQuote(options.node), ENTRY_QUOTED: systemdQuote(entry), STATE_QUOTED: systemdQuote(state) }),
    nginx: template("syntx-ai.nginx.conf.tpl", { BASE_PATH: options.basePath, PROXY_SETTINGS: proxySettings }) };
}
