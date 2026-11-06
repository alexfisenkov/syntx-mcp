import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDeploymentArguments, renderDeploymentPlan, systemdQuote, BODY_BYTES } from "./private-owner-plan.mjs";
import { currentTarget, assertTargetCAS, sha256 } from "./private-owner-preflight.mjs";

const args = ["--release", "/opt/syntx/releases/public-0123", "--expected-commit", "a".repeat(40), "--node", "/opt/node24/bin/node",
  "--ffmpeg", "/usr/bin/ffmpeg", "--ffprobe", "/usr/bin/ffprobe", "--vhost", "/etc/nginx/sites-available/example", "--expected-vhost-sha256", "b".repeat(64)];
const environment = { SYNTX_OWNER_MEDIA_PROFILE: "all-supported", SYNTX_MEDIA_FFPROBE_PATH: "/usr/bin/ffprobe", SYNTX_MEDIA_FFMPEG_PATH: "/usr/bin/ffmpeg" };
test("deployment planner is inert by default and confines nginx to namespace plus two exact metadata locations", () => {
  const options = parseDeploymentArguments(args), plan = renderDeploymentPlan(options, environment);
  assert.equal(options.apply, false); assert.equal(options.port, 8860); assert.equal(options.domain, "mcp.example.com");
  assert.equal(plan.config.maxBodyBytes, BODY_BYTES); assert.equal(plan.config.child.environment.SYNTX_STDIO_MAX_BUFFER_BYTES, String(BODY_BYTES));
  assert.equal(plan.config.child.environment.SYNTX_OWNER_AUTH_KEY_FILE, "/var/lib/syntx-mcp/auth.key");
  assert.deepEqual([...plan.nginx.matchAll(/^location ([^{]+)\{/gmu)].map((m) => m[1].trim()), ["^~ /syntx-ai/", "= /.well-known/oauth-authorization-server/syntx-ai", "= /.well-known/oauth-protected-resource/syntx-ai/mcp"]);
  assert.equal((plan.nginx.match(/auth_request off;/gu) ?? []).length, 3); assert.equal((plan.nginx.match(/access_log off;/gu) ?? []).length, 3);
  assert.equal((plan.nginx.match(/proxy_intercept_errors off;/gu) ?? []).length, 3);
  assert.equal((plan.nginx.match(/proxy_pass_request_headers on;/gu) ?? []).length, 3);
  assert.equal((plan.nginx.match(/proxy_set_header Authorization \$http_authorization;/gu) ?? []).length, 3);
  assert.match(plan.nginx, /proxy_set_header X-Forwarded-For "";/u); assert.match(plan.nginx, /client_max_body_size 192M;/u);
  assert.match(plan.unit, /MemoryMax=3G/u); assert.match(plan.unit, /CPUQuota=100%/u); assert.match(plan.unit, /TimeoutStopSec=960/u);
  assert.match(plan.unit, /^WorkingDirectory=\/opt\/syntx\/releases\/public-0123$/mu);
  assert.match(plan.unit, /^ReadWritePaths=\/var\/lib\/syntx-mcp$/mu);
  assert.match(plan.unit, /^KillMode=mixed$/mu); assert.doesNotMatch(plan.unit, /KillMode=control-group/u);
  assert.match(plan.unit, /User=syntx-mcp/u); assert.match(plan.unit, /ProtectSystem=strict/u); assert.equal(plan.unit.includes("@@"), false);
});
test("deployment arguments reject route/header/command injection, unknown flags and apply without CI receipt", () => {
  for (const tail of [["--domain", "example.com;inject"], ["--base-path", "/"], ["--port", "80"], ["--user", "root;id"],
    ["--expected-unit-sha256", "force"], ["--apply"], ["--unknown", "x"]]) assert.throws(() => parseDeploymentArguments([...args, ...tail]));
  const options = parseDeploymentArguments([...args, "--apply", "--ci-run-url", "https://github.com/alexfisenkov/syntx-mcp/actions/runs/123"]);
  assert.equal(options.apply, true); assert.equal(options.expectedUnitSha256, "absent");
  assert.throws(() => renderDeploymentPlan(options, { ...environment, SYNTX_API_KEY: "not-allowed" }));
  assert.throws(() => renderDeploymentPlan(options, { ...environment, SYNTX_MEDIA_FFMPEG_PATH: "<placeholder>" }));
});
test("systemd quotes trusted paths with spaces/percent/backslashes without interpreting specifiers", () => {
  assert.equal(systemdQuote('/opt/a b/100%/"node"'), '"/opt/a b/100%%/\\"node\\""');
  const options = parseDeploymentArguments(args);
  assert.throws(() => renderDeploymentPlan({ ...options, release: "/opt/a b" }, environment), /DEPLOY_SYSTEMD_PATH_UNSUPPORTED/u);
});
test("deployment CAS rejects drift and symlinks before any writer is reached", () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "syntx-deploy-cas-"));
  try {
    const path = join(directory, "namespace.conf"); assert.equal(currentTarget(path).sha256, "absent"); assertTargetCAS(path, "absent");
    writeFileSync(path, "old\n", { mode: 0o600 }); const old = sha256(readFileSync(path)); assertTargetCAS(path, old);
    writeFileSync(path, "changed\n"); assert.throws(() => assertTargetCAS(path, old), /DEPLOY_TARGET_CHANGED/u);
    const symlink = join(directory, "link.conf"); symlinkSync(path, symlink); assert.throws(() => currentTarget(symlink), /DEPLOY_TARGET_UNSAFE/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
