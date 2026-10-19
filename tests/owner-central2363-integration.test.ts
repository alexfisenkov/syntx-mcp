import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_ACTTWO_TOOL_NAMES } from "../src/mcp/owner-acttwo-tools.js";
import { OWNER_HEYGEN4_TOOL_NAMES } from "../src/mcp/owner-heygen4-tools.js";
import { OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME } from "../src/mcp/owner-existing-video-recovery-tools.js";
import { readOwnerActTwoFlag, readOwnerActTwoOperatorConfiguration } from "../src/runtime/owner-acttwo-stdio-config.js";
import { readOwnerHeygen4OperatorConfiguration } from "../src/runtime/owner-heygen4-stdio-config.js";
import { readOwnerExistingVideoRecoveryFlag, readOwnerHeygen4Flag } from "../src/transports/stdio-owner.js";

const ATTEMPT = "link_central2363_attempt_0123456789";

test("ActTwo, HeyGen 4 and existing-video recovery remain default-off with no startup fetch", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { fetchCalls += 1; throw new Error("unexpected fetch"); } });
  const options = runtime.serverOptions as unknown as Record<string, unknown>;
  assert.equal(options.ownerActTwo, undefined);
  assert.equal(options.ownerHeygen4, undefined);
  assert.equal(options.ownerExistingVideoRecovery, undefined);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "central2363-default-off", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of [...OWNER_ACTTWO_TOOL_NAMES, ...OWNER_HEYGEN4_TOOL_NAMES, OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME]) {
      assert.equal(names.includes(name), false);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("explicit central opt-ins register the expected tools, stay fetch-free, and close cleanly", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    fetchImpl: async () => { fetchCalls += 1; throw new Error("unexpected fetch"); },
    ownerActTwoEnabled: true,
    ownerActTwoUploadDestination: "hidden",
    ownerActTwoFfprobePath: "/usr/bin/ffprobe",
    ownerHeygen4Enabled: true,
    ownerHeygen4FfprobePath: "/usr/bin/ffprobe",
    ownerExistingVideoRecoveryEnabled: true
  });
  const options = runtime.serverOptions as unknown as Record<string, any>;
  assert.ok(options.ownerActTwo?.imageReferenceService);
  assert.ok(options.ownerActTwo?.videoReferenceService);
  assert.ok(options.ownerActTwo?.generationService);
  assert.ok(options.ownerHeygen4?.importService);
  assert.ok(options.ownerHeygen4?.service);
  assert.ok(options.ownerExistingVideoRecovery?.recoveryService);
  assert.equal(fetchCalls, 0);

  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "central2363-registration", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of [...OWNER_ACTTWO_TOOL_NAMES, ...OWNER_HEYGEN4_TOOL_NAMES, OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME]) {
      assert.equal(names.includes(name), true, name);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    await client.close();
    await server.close();
    const lifecycleRuntime = runtime as unknown as {
      ownerActTwoLifecycle: { invalidateAttempt(id: string): Promise<void>; close(): Promise<void> };
      ownerHeygen4Lifecycle: { invalidateAttempt(id: string): Promise<void>; close(): Promise<void> };
      ownerExistingVideoRecoveryLifecycle: { invalidateAttempt(id: string): Promise<void>; close(): Promise<void> };
    };
    for (const name of ["ownerActTwoLifecycle", "ownerHeygen4Lifecycle", "ownerExistingVideoRecoveryLifecycle"] as const) {
      await lifecycleRuntime[name].invalidateAttempt(ATTEMPT);
      await lifecycleRuntime[name].close();
    }
  }
});

test("central operator flags are strict and require only the relevant trusted settings", () => {
  for (const read of [readOwnerActTwoFlag, readOwnerHeygen4Flag, readOwnerExistingVideoRecoveryFlag]) {
    assert.equal(read(undefined), false);
    assert.equal(read("0"), false);
    assert.equal(read("1"), true);
    assert.throws(() => read("true"));
  }
  assert.equal(readOwnerActTwoOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerActTwoOperatorConfiguration(true, undefined, undefined));
  assert.deepEqual(readOwnerActTwoOperatorConfiguration(true, "uploaded", "/usr/bin/ffprobe"), {
    uploadDestination: "uploaded", ffprobePath: "/usr/bin/ffprobe"
  });
  assert.equal(readOwnerHeygen4OperatorConfiguration(false, undefined), undefined);
  assert.throws(() => readOwnerHeygen4OperatorConfiguration(true, "relative/ffprobe"));
  assert.deepEqual(readOwnerHeygen4OperatorConfiguration(true, "/usr/bin/ffprobe"), { ffprobePath: "/usr/bin/ffprobe" });
});
