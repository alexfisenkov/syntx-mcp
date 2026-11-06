import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = realpathSync(process.cwd());
const entry = process.env.SYNTX_TEST_HTTPS_ENTRY ?? join(root, "dist/src/transports/https-owner.js");
const require = createRequire(import.meta.url);
const sdk = (id: string) => pathToFileURL(require.resolve(id)).href;
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const posixFixtureOnly = process.platform === "win32" ? "Requires a /bin/sh fixture; the HTTPS installer targets Linux." : false;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("STARTUP_TEST_WAIT_EXPIRED");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function health(port: number): Promise<number | null> {
  try { return (await fetch(`http://127.0.0.1:${port}/syntx-ai/health`, { signal: AbortSignal.timeout(300) })).status; }
  catch { return null; }
}
async function waitExit(child: ChildProcess, timeoutMs = 6000): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("STARTUP_TEST_EXIT_TIMEOUT")), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
}
async function waitDead(pid: number): Promise<void> {
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; }
  });
}
async function fixture(mode: "normal" | "fail") {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "syntx-https-startup-"));
  const oauth = join(directory, "oauth"); mkdirSync(oauth, { mode: 0o700 });
  const port = await availablePort();
  const pidFile = join(directory, "child.pid"), allowInit = join(directory, "allow-init"), listSeen = join(directory, "list-seen"), allowList = join(directory, "allow-list");
  const childScript = join(directory, "child.mjs"), childWrapper = join(directory, "child.sh");
  const script = `
    import {writeFileSync,existsSync} from 'node:fs';
    import {Server} from ${JSON.stringify(sdk("@modelcontextprotocol/sdk/server/index.js"))};
    import {StdioServerTransport} from ${JSON.stringify(sdk("@modelcontextprotocol/sdk/server/stdio.js"))};
    import {ListToolsRequestSchema} from ${JSON.stringify(sdk("@modelcontextprotocol/sdk/types.js"))};
    writeFileSync(process.env.SYNTX_TEST_PID_FILE,String(process.pid),{flag:'wx'});
    if(process.env.SYNTX_TEST_MODE==='fail')process.exit(9);
    let closed=false;
    const gate=async(path)=>{for(let n=0;n<250;n++){if(closed)throw Error('CLOSED');if(existsSync(path))return;await new Promise(r=>setTimeout(r,20));}throw Error('GATE_TIMEOUT')};
    await gate(process.env.SYNTX_TEST_ALLOW_INIT);
    const server=new Server({name:'synthetic-startup-child',version:'1'},{capabilities:{tools:{}}});
    server.onclose=()=>{closed=true;process.stdin.destroy()};
    server.setRequestHandler(ListToolsRequestSchema,async()=>{
      writeFileSync(process.env.SYNTX_TEST_LIST_SEEN,'1',{flag:'wx'});
      await gate(process.env.SYNTX_TEST_ALLOW_LIST);
      return {tools:[{name:'syntx_test_read',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};
    });
    await server.connect(new StdioServerTransport());
  `;
  writeFileSync(childScript, script, { mode: 0o600 });
  writeFileSync(childWrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(childScript)}\n`, { mode: 0o700 });
  const config = join(directory, "launch.json");
  writeFileSync(config, JSON.stringify({ publicOrigin: "https://owner.example", basePath: "/syntx-ai", stateDirectory: oauth,
    ownerSubject: "synthetic-startup", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    allowedOrigins: ["https://chatgpt.com"], port, maxBodyBytes: 1024,
    child: { nodeExecutable: childWrapper, environment: { SYNTX_OWNER_MEDIA_PROFILE: "all-supported",
      SYNTX_OWNER_AUTH_PROFILE_DIRECTORY: join(directory, "fake-profile"), SYNTX_OWNER_AUTH_KEY_FILE: join(directory, "fake-key"),
      SYNTX_TEST_MODE: mode, SYNTX_TEST_PID_FILE: pidFile, SYNTX_TEST_ALLOW_INIT: allowInit,
      SYNTX_TEST_LIST_SEEN: listSeen, SYNTX_TEST_ALLOW_LIST: allowList } } }), { mode: 0o600 });
  const gateway = spawn(process.execPath, [entry, "serve"], { cwd: root,
    env: { HOME: directory, PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", SYNTX_HTTPS_CONFIG_FILE: config }, stdio: "ignore" });
  return { directory, port, gateway, pidFile, allowInit, listSeen, allowList, close: async () => {
    if (gateway.exitCode === null && gateway.signalCode === null) gateway.kill("SIGTERM");
    try { await waitExit(gateway); } catch { gateway.kill("SIGKILL"); await waitExit(gateway); }
    rmSync(directory, { recursive: true, force: true });
  } };
}

test("CLI warms canonical child and cached tools before listening; unauthenticated request does not spawn another child", { timeout: 15_000, skip: posixFixtureOnly }, async () => {
  const f = await fixture("normal");
  try {
    await waitFor(() => existsSync(f.pidFile));
    const childPid = Number(readFileSync(f.pidFile, "utf8"));
    assert.equal(await health(f.port), null);
    writeFileSync(f.allowInit, "1", { flag: "wx" });
    await waitFor(() => existsSync(f.listSeen));
    assert.equal(await health(f.port), null);
    writeFileSync(f.allowList, "1", { flag: "wx" });
    await waitFor(async () => (await health(f.port)) === 200, 5000);
    assert.equal(f.gateway.exitCode, null);
    const unauthorized = await fetch(`http://127.0.0.1:${f.port}/syntx-ai/mcp`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    assert.equal(Number(readFileSync(f.pidFile, "utf8")), childPid);
    f.gateway.kill("SIGTERM");
    assert.equal(await waitExit(f.gateway), 0);
    await waitDead(childPid);
    assert.equal(await health(f.port), null);
  } finally { await f.close(); }
});

test("CLI warm failure exits before binding and closes its child", { timeout: 10_000, skip: posixFixtureOnly }, async () => {
  const f = await fixture("fail");
  try {
    await waitFor(() => existsSync(f.pidFile));
    const childPid = Number(readFileSync(f.pidFile, "utf8"));
    assert.equal(await waitExit(f.gateway), 1);
    await waitDead(childPid);
    assert.equal(await health(f.port), null);
  } finally { await f.close(); }
});

test("SIGTERM during tools warm closes child and never binds listener", { timeout: 15_000, skip: posixFixtureOnly }, async () => {
  const f = await fixture("normal");
  try {
    await waitFor(() => existsSync(f.pidFile));
    const childPid = Number(readFileSync(f.pidFile, "utf8"));
    writeFileSync(f.allowInit, "1", { flag: "wx" });
    await waitFor(() => existsSync(f.listSeen));
    assert.equal(await health(f.port), null);
    f.gateway.kill("SIGTERM");
    assert.equal(await waitExit(f.gateway), 0);
    await waitDead(childPid);
    assert.equal(await health(f.port), null);
  } finally { await f.close(); }
});
