import assert from "node:assert/strict";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChildProcess } from "node:child_process";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_WAN26_R2V_TOOL_NAMES } from "../src/mcp/owner-wan26-r2v-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerImageReferenceServiceOnTransportEof,
  readOwnerWan26R2vFlag,
  readOwnerWan26R2vOperatorConfiguration
} from "../src/transports/stdio-owner.js";
import {
  OWNER_AUTH_KEY_FILE_ENV,
  OWNER_AUTH_PROFILE_DIRECTORY_ENV,
  openPrivateOwnerAuthProfile
} from "../src/auth/private-owner-auth-profile.js";

const ATTEMPT = "link_wan26_r2v_runtime_1769_0123";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function withTools<T>(runtime: ReturnType<typeof createObservedOwnerRuntime>, run: (client: Client) => Promise<T>): Promise<T> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-wan26-r2v-runtime-1769", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("WAN26 R2V operator flag is strict and ignored paths stay inert while disabled", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerWan26R2vFlag(value), false);
  assert.equal(readOwnerWan26R2vFlag("1"), true);
  for (const value of ["true", " 1", "01", "2"]) assert.throws(() => readOwnerWan26R2vFlag(value));
  assert.equal(readOwnerWan26R2vOperatorConfiguration(false, "relative/ffprobe", "\0"), undefined);
  assert.deepEqual(readOwnerWan26R2vOperatorConfiguration(true, "/usr/bin/ffprobe", "/usr/bin/ffmpeg"), {
    ffprobePath: "/usr/bin/ffprobe", ffmpegPath: "/usr/bin/ffmpeg"
  });
  for (const paths of [["relative/ffprobe", "/usr/bin/ffmpeg"], ["/usr/bin/ffprobe", "relative/ffmpeg"],
    ["/usr/bin/ffprobe\0x", "/usr/bin/ffmpeg"]]) {
    assert.throws(() => readOwnerWan26R2vOperatorConfiguration(true, paths[0], paths[1]));
  }
});

test("runtime is default-off and opt-in builds genuine owner composition without startup requests", async () => {
  let requestCount = 0;
  const fetchImpl: typeof fetch = async () => { requestCount += 1; throw new Error("synthetic transport must not be used at startup"); };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(disabled.serverOptions.ownerWan26R2v, undefined);
  await withTools(disabled, async (client) => {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_WAN26_R2V_TOOL_NAMES as readonly string[]).includes(name)), false);
  });

  const enabled = createObservedOwnerRuntime({ fetchImpl, ownerWan26R2vEnabled: true,
    ownerWan26R2vFfprobePath: "/usr/bin/ffprobe", ownerWan26R2vFfmpegPath: "/usr/bin/ffmpeg" });
  assert.ok(enabled.serverOptions.ownerWan26R2v?.referenceService);
  assert.ok(enabled.serverOptions.ownerWan26R2v?.generationService);
  assert.equal(requestCount, 0);
  await withTools(enabled, async (client) => {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of OWNER_WAN26_R2V_TOOL_NAMES) assert.ok(names.includes(name));
  });
  await enabled.ownerWan26R2vLifecycle?.close();
  assert.equal(requestCount, 0);
});

test("runtime revocation invalidates R2V state before the auth store is revoked", async () => {
  const store = new InMemoryAuthLinkStore();
  const runtime = createObservedOwnerRuntime({ authStore: store, ownerWan26R2vEnabled: true,
    ownerWan26R2vFfprobePath: "/usr/bin/ffprobe", ownerWan26R2vFfmpegPath: "/usr/bin/ffmpeg",
    fetchImpl: async () => { throw new Error("unexpected network request"); } });
  const binding = runtime.authBinding;
  await store.createAttempt({ attempt_id: ATTEMPT, binding, expires_at_ms: Date.now() + 60_000 });
  await store.beginHandoff(binding, ATTEMPT);
  await store.attachChallenge(binding, ATTEMPT, "synthetic-upstream-attempt");
  await store.beginPoll(binding, ATTEMPT);
  await store.markLinked(binding, ATTEMPT, { scheme: "Bearer", value: "synthetic-owner-credential" });

  const auth = runtime.serverOptions.auth;
  assert.ok(auth);
  await auth.linkService.revoke(binding, ATTEMPT);
  assert.equal((await store.getSnapshot(binding, ATTEMPT)).status, "REVOKED");
  await runtime.ownerWan26R2vLifecycle?.close();
});

test("synthetic stdio transport drains R2V lifecycle before releasing owner auth", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transportState: { onclose: (() => void) | undefined; close(): Promise<void>; start(): Promise<void>; send(): Promise<void> } = {
    onclose: undefined as (() => void) | undefined,
    async close() { transportState.onclose?.(); },
    async start() {},
    async send() {},
  };
  const transport = transportState as unknown as Transport;
  const close = closeOwnerImageReferenceServiceOnTransportEof(transport, {
    async close() { events.push("r2v-drained"); }
  }, () => events.push("auth-released"), input);
  await close();
  assert.deepEqual(events, ["r2v-drained", "auth-released"]);
  input.destroy();
});

test("public barrel resolves the R2V runtime, policy, MCP and operator exports", async () => {
  const api = await import("../src/index.js");
  assert.deepEqual(api.OWNER_WAN26_R2V_TOOL_NAMES, OWNER_WAN26_R2V_TOOL_NAMES);
  assert.equal(typeof api.registerSyntxOwnerWan26R2vTools, "function");
  assert.equal(typeof api.OwnerWan26R2vGenerationService, "function");
  assert.equal(typeof api.OwnerWan26R2vReferenceService, "function");
  assert.equal(typeof api.createOwnerWan26R2vRequestPreparer, "function");
  assert.equal(typeof api.createOwnerWan26R2vOneShotPermit, "function");
  assert.equal(typeof api.readOwnerWan26R2vFlag, "function");
});

function isolatedOwnerStdioEntrypoint(): string {
  return fileURLToPath(new URL("../src/transports/stdio-owner.js", import.meta.url));
}

function createLocalProfile(root: string): Readonly<{ profileDirectory: string; keyFilePath: string }> {
  const profileDirectory = join(root, "owner-profile");
  const keyFilePath = join(root, "owner-profile.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 176), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  return Object.freeze({ profileDirectory, keyFilePath });
}

function createNoNetworkPreload(root: string): string {
  const path = join(root, "deny-fetch.mjs");
  writeFileSync(path, [
    'import { appendFileSync } from "node:fs";',
    'const audit = process.env.SYNTX_1769_FETCH_AUDIT;',
    'globalThis.fetch = async () => { if (audit) appendFileSync(audit, "fetch\\n", { mode: 0o600 }); throw new Error("network disabled in runtime fixture"); };',
    ""
  ].join("\n"), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function childEnvironment(profile: Readonly<{ profileDirectory: string; keyFilePath: string }>, auditPath: string,
  flag?: string, mediaPaths?: Readonly<{ ffprobePath: string; ffmpegPath: string }>): Record<string, string> {
  const clean = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string" && !entry[0].startsWith("SYNTX_OWNER_") && entry[0] !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  return {
    ...clean,
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profile.profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: profile.keyFilePath,
    SYNTX_1769_FETCH_AUDIT: auditPath,
    ...(flag === undefined ? {} : { SYNTX_OWNER_WAN26_R2V: flag }),
    ...(mediaPaths === undefined ? {} : {
      SYNTX_OWNER_WAN26_R2V_FFPROBE_PATH: mediaPaths.ffprobePath,
      SYNTX_OWNER_WAN26_R2V_FFMPEG_PATH: mediaPaths.ffmpegPath
    })
  };
}

function createOwnerStdioChild(env: Record<string, string>, preload: string, context: TestContext) {
  const client = new Client({ name: "owner-wan26-r2v-runtime-1769-stdio", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", preload, isolatedOwnerStdioEntrypoint()],
    cwd: process.cwd(), env, stderr: "pipe" });
  let child: ChildProcess | undefined;
  let exit: Promise<[number | null, NodeJS.Signals | null]> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const captureChild = (): void => {
    child = (transport as unknown as { _process?: ChildProcess })._process;
    if (child !== undefined && exit === undefined) exit = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  };
  const cleanup = (): Promise<void> => {
    if (cleanupPromise !== undefined) return cleanupPromise;
    cleanupPromise = (async () => {
      await withTimeout(client.close(), 5_000, "OWNER_STDIO_CLIENT_CLOSE_TIMEOUT").catch(() => undefined);
      await withTimeout(transport.close(), 5_000, "OWNER_STDIO_TRANSPORT_CLOSE_TIMEOUT").catch(() => undefined);
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await withTimeout(exit ?? Promise.resolve<[number | null, NodeJS.Signals | null]>([null, null]),
          1_000, "OWNER_STDIO_CHILD_TERM_TIMEOUT").catch(() => {
          child?.kill("SIGKILL");
        });
      }
    })();
    return cleanupPromise;
  };
  context.after(cleanup);
  return { client, transport, captureChild, cleanup, get child() { return child; }, get exit() { return exit; } };
}

async function launchOwnerStdio(env: Record<string, string>, preload: string, context: TestContext) {
  const owner = createOwnerStdioChild(env, preload, context);
  const connecting = owner.client.connect(owner.transport as unknown as Transport);
  owner.captureChild();
  try {
    await withTimeout(connecting, 15_000, "OWNER_STDIO_CONNECT_TIMEOUT");
    assert.ok(owner.child, "stdio SDK did not retain the spawned child process");
    assert.ok(owner.exit);
    return owner;
  } catch (error) {
    await owner.cleanup();
    throw error;
  }
}

test("isolated owner stdio child lists WAN26 R2V only with opt-in and closes its temporary auth profile on EOF", {
  timeout: 30_000
}, async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-wan26-r2v-runtime-1769-"));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = createLocalProfile(root);
  const preload = createNoNetworkPreload(root);
  const auditPath = join(root, "fetch-audit.log");
  const mediaPaths = Object.freeze({ ffprobePath: join(root, "unused-ffprobe"), ffmpegPath: join(root, "unused-ffmpeg") });

  for (const enabled of [false, true]) {
    const launched = await launchOwnerStdio(childEnvironment(profile, auditPath, enabled ? "1" : undefined,
      enabled ? mediaPaths : undefined), preload, t);
    try {
      const names = (await withTimeout(launched.client.listTools(), 10_000, "OWNER_STDIO_LIST_TOOLS_TIMEOUT")).tools.map(({ name }) => name);
      const actual = names.filter((name) => (OWNER_WAN26_R2V_TOOL_NAMES as readonly string[]).includes(name));
      assert.deepEqual(actual.sort(), (enabled ? [...OWNER_WAN26_R2V_TOOL_NAMES] : []).sort());
      assert.equal(existsSync(auditPath), false, "runtime startup/list must not issue HTTP requests");
    } finally {
      await launched.cleanup();
    }
    assert.ok(launched.exit);
    const [code, signal] = await withTimeout(launched.exit, 5_000, "OWNER_STDIO_EOF_EXIT_TIMEOUT");
    assert.equal(code, 0, `owner stdio child exited with signal ${signal}`);
    assert.equal(signal, null);
    assert.equal(existsSync(auditPath), false);
    const reopened = openPrivateOwnerAuthProfile(profile);
    reopened.close();
  }

  for (const invalid of [
    childEnvironment(profile, auditPath, "true", mediaPaths),
    childEnvironment(profile, auditPath, "1", { ffprobePath: "relative/ffprobe", ffmpegPath: mediaPaths.ffmpegPath })
  ]) {
    const childOwner = createOwnerStdioChild(invalid, preload, t);
    const invalidConnect = childOwner.client.connect(childOwner.transport as unknown as Transport);
    childOwner.captureChild();
    try {
      await assert.rejects(withTimeout(invalidConnect, 15_000, "OWNER_STDIO_INVALID_CONNECT_TIMEOUT"));
      assert.ok(childOwner.child, "stdio SDK did not retain the invalid-config child process");
      assert.ok(childOwner.exit);
      const [code] = await withTimeout(childOwner.exit, 5_000, "OWNER_STDIO_INVALID_EXIT_TIMEOUT");
      assert.notEqual(code, 0);
      assert.equal(existsSync(auditPath), false);
      const reopened = openPrivateOwnerAuthProfile(profile);
      reopened.close();
    } finally {
      await childOwner.cleanup();
    }
  }
});
