import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES } from "../src/mcp/server.js";
import { SYNTX_AUTH_TOOL_NAMES } from "../src/mcp/auth-tools.js";
import { SYNTX_MODEL_ACCESS_TOOL_NAME } from "../src/mcp/model-access-tool.js";
import { SYNTX_ACCOUNT_STATUS_TOOL_NAME } from "../src/mcp/account-status-tool.js";
import {
  SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-generate-image-tool.js";
import { SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME } from "../src/mcp/owner-generate-video-tool.js";
import {
  SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME,
  SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME,
  SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME
} from "../src/mcp/owner-durable-live-generation-tools.js";
import {
  OWNER_AUTH_KEY_FILE_ENV,
  OWNER_AUTH_PROFILE_DIRECTORY_ENV,
  openPrivateOwnerAuthProfile
} from "../src/auth/private-owner-auth-profile.js";
import { closeOwnerDurableSessionOnTransportEof } from "../src/transports/owner-durable-stdio-lifecycle.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

function createProfileFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-durable-stdio-test-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "account-profile");
  const keyFilePath = join(root, "account.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 59), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  return { root, profileDirectory, keyFilePath };
}

function ownerStdioEntrypoint(): string {
  return process.env.SYNTX_TEST_OWNER_STDIO_ENTRYPOINT ?? resolve("dist/src/transports/stdio-owner.js");
}

test("built stdio launcher initializes and lists the same stable tools", async () => {
  const client = new Client({ name: "stdio-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio.js")],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  await client.connect(transport as unknown as Transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      TOOL_NAMES
    );
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher leaves new account-status read disabled by default", async () => {
  const client = new Client({ name: "owner-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {},
    stderr: "pipe"
  });

  await client.connect(transport as unknown as Transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      ...TOOL_NAMES,
      ...SYNTX_AUTH_TOOL_NAMES,
      SYNTX_MODEL_ACCESS_TOOL_NAME
    ]);
    for (const name of ["syntx_check_login", "syntx_unlink"] as const) {
      assertSafeInvalidAuthInput(
        (await client.callTool({ name })) as CallToolResult
      );
    }
  } finally {
    await client.close();
  }
});

test("durable owner generation requires an existing private auth profile", async () => {
  const client = new Client({ name: "owner-durable-requires-profile-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ownerStdioEntrypoint()],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_DURABLE_GENERATION: "1" },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("durable owner stdio registers only its three tools and closes the profile lease on EOF", async (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new Client({ name: "owner-durable-stdio-null-registry-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ownerStdioEntrypoint()],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_DURABLE_GENERATION: "1",
      [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
      [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
    },
    stderr: "pipe"
  });
  try {
    await client.connect(transport as unknown as Transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      ...TOOL_NAMES, ...SYNTX_AUTH_TOOL_NAMES, SYNTX_MODEL_ACCESS_TOOL_NAME,
      SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME,
      SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME,
      SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME
    ]);
    const start = await client.callTool({
      name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME,
      arguments: {
        link_attempt_id: "link_unknown_attempt_0000000000",
        model_id: "model",
        operation_id: "generate-image",
        variant_id: "variant",
        parameters: { prompt: "test only" },
        idempotency_key: "durable-test-1"
      }
    }) as CallToolResult;
    assert.equal(start.isError, true);
    assert.equal(start.structuredContent, undefined);
    const startText = start.content.find((item) => item.type === "text");
    assert.equal(startText?.type, "text");
    assert.equal((JSON.parse(startText.text) as { error: { code: string } }).error.code, "OWNER_LIVE_UNAVAILABLE");
  } finally {
    await client.close();
  }
  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  reopened.close();
});

test("durable owner V2 pin also selects the normal read-only generation schema", async (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new Client({ name: "owner-durable-v2-schema-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ownerStdioEntrypoint()],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_DURABLE_GENERATION: "1",
      SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
      [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
      [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
    },
    stderr: "pipe"
  });
  try {
    await client.connect(transport as unknown as Transport);
    await client.listTools();
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        variant_id: "banana21-image-1k-minimal-square"
      }
    });
    const output = schema.structuredContent as Record<string, unknown>;
    assert.equal(output.contract_schema_version, "2.0.0");
    assert.equal(output.variant_id, "banana21-image-1k-minimal-square");
    const durableTools = (await client.listTools()).tools.map((tool) => tool.name).filter((name) => name.startsWith("syntx_owner_"));
    assert.deepEqual(durableTools, [
      SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME,
      SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME,
      SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME
    ]);
  } finally {
    await client.close();
  }
});

test("durable owner stdio rejects V1, malformed pins, and legacy paid tools before opening the profile", async (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const invalidOptions = [
    { SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "1.0.0" },
    { SYNTX_GENERATION_CONTRACT_VERSION: "not-a-hash", SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0" },
    { SYNTX_OWNER_GENERATE_IMAGE: "1" }
  ];
  for (const options of invalidOptions) {
    const client = new Client({ name: "owner-durable-invalid-config-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ownerStdioEntrypoint()],
      cwd: process.cwd(),
      env: {
        SYNTX_OWNER_DURABLE_GENERATION: "1",
        [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
        [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath,
        ...options
      },
      stderr: "pipe"
    });
    try { await assert.rejects(client.connect(transport as unknown as Transport)); }
    finally { await client.close(); }
    const profile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
    profile.close();
  }
});

test("durable owner transport startup failure closes the manager-owned profile", async (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = [
    "SYNTX_OWNER_DURABLE_GENERATION",
    OWNER_AUTH_PROFILE_DIRECTORY_ENV,
    OWNER_AUTH_KEY_FILE_ENV,
    "SYNTX_GENERATION_CONTRACT_VERSION",
    "SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION"
  ];
  const previous = names.map((name) => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    const value = previous[index];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }));
  process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
  process.env[OWNER_AUTH_PROFILE_DIRECTORY_ENV] = profileDirectory;
  process.env[OWNER_AUTH_KEY_FILE_ENV] = keyFilePath;

  const input = new PassThrough();
  const originalOn = input.on.bind(input);
  input.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "data") throw new Error("synthetic durable stdio startup failure");
    return originalOn(event as never, listener as never);
  }) as typeof input.on;
  t.after(() => input.destroy());
  await assert.rejects(runObservedOwnerStdioServer(input));
  const profile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  profile.close();
});

test("durable owner EOF closes the manager before transport close settles and observes failure once", async () => {
  const input = new PassThrough();
  let closeCalls = 0;
  let transportCloseCalls = 0;
  let releaseTransportClose!: () => void;
  const transportCloseGate = new Promise<void>((resolve) => { releaseTransportClose = resolve; });
  const transportState: { onclose: (() => void) | undefined; close: () => Promise<void> } = {
    onclose: undefined,
    async close() {
      transportCloseCalls += 1;
      transportState.onclose?.();
      await transportCloseGate;
    }
  };
  const transport = transportState as unknown as Transport;
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  let closeOnce!: () => Promise<void>;
  let reentrantClose: Promise<void> | undefined;
  closeOnce = closeOwnerDurableSessionOnTransportEof(transport, async () => {
    closeCalls += 1;
    reentrantClose = closeOnce();
    throw new Error("synthetic manager close failure");
  }, input);
  try {
    input.emit("end");
    assert.equal(closeCalls, 1, "EOF invokes manager.close synchronously before transport.close settles");
    const managerClosePromise = closeOnce();
    assert.equal(reentrantClose, managerClosePromise, "reentrant close uses the cached promise");
    assert.equal(transportCloseCalls, 1);
    releaseTransportClose();
    await assert.rejects(managerClosePromise);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closeCalls, 1);
    assert.equal(input.listenerCount("end"), 0);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
    input.destroy();
  }
});

test("durable owner EOF observes manager rejection while transport close is pending without onclose", async () => {
  const input = new PassThrough();
  let closeCalls = 0;
  let transportCloseCalls = 0;
  let releaseTransportClose!: () => void;
  const transportCloseGate = new Promise<void>((resolve) => { releaseTransportClose = resolve; });
  const transport = {
    async close() {
      transportCloseCalls += 1;
      await transportCloseGate;
    }
  } as unknown as Transport;
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => { unhandledRejections.push(reason); };
  process.on("unhandledRejection", onUnhandledRejection);
  const closeOnce = closeOwnerDurableSessionOnTransportEof(transport, async () => {
    closeCalls += 1;
    throw new Error("synthetic manager close failure without onclose");
  }, input);
  try {
    input.emit("end");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(process.exitCode, 1, "manager failure is reported before transport close settles");
    assert.deepEqual(unhandledRejections, []);
    assert.equal(closeCalls, 1);
    assert.equal(transportCloseCalls, 1);
    releaseTransportClose();
    await assert.rejects(closeOnce);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandledRejections, []);
    assert.equal(closeCalls, 1);
  } finally {
    releaseTransportClose();
    process.off("unhandledRejection", onUnhandledRejection);
    process.exitCode = previousExitCode;
    input.destroy();
  }
});

test("schema-version selector is ignored while contract-media owner opt-in is off", async () => {
  const client = new Client({ name: "owner-contract-media-disabled-schema-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "future" },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("syntx_owner_generate_media"), false);
    assert.equal(names.includes("syntx_get_generation_schema"), true);
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher registers account status only with exact operator flag", async () => {
  const client = new Client({ name: "owner-account-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_ACCOUNT_STATUS: "1" },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      ...TOOL_NAMES, ...SYNTX_AUTH_TOOL_NAMES,
      SYNTX_MODEL_ACCESS_TOOL_NAME, SYNTX_ACCOUNT_STATUS_TOOL_NAME
    ]);
    assert.equal(listed.tools.length, 20);
    const result = await client.callTool({ name: SYNTX_ACCOUNT_STATUS_TOOL_NAME, arguments: {
      link_attempt_id: "link_unknown_attempt_0000000000"
    } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AUTH_REQUIRED/u);
  } finally {
    await client.close();
  }
});

test("owner contract-media opt-in refuses startup without a pinned registry version", async () => {
  const client = new Client({ name: "owner-contract-media-unpinned-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1" },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("owner contract-media opt-in uses only the exact pinned registry for tools and read-only schemas", async () => {
  const client = new Client({ name: "owner-contract-media-pinned-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json"
    },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes("syntx_owner_generate_media"));
    assert.ok(names.includes("syntx_owner_reconcile_media"));
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana-2.1", operation_id: "generate-image" }
    });
    assert.equal((schema.structuredContent as Record<string, unknown>).schema_version, "1.0.0");
    assert.equal((schema.structuredContent as Record<string, unknown>).contract_schema_version, undefined);
    assert.equal((schema.structuredContent as Record<string, unknown>).schema_status, "live_verified");
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: "synthetic read-only validation fixture", file_urls: [] }
      }
    });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "VALID");
    assert.equal(JSON.stringify(validation).includes("synthetic read-only validation fixture"), false);
  } finally {
    await client.close();
  }
});

test("owner stdio v2 opt-in uses the explicit v2 namespace for read-only schema and validation", async () => {
  const client = new Client({ name: "owner-contract-media-v2-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json"
    },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("syntx_owner_generate_media"), true);
    assert.equal(names.includes("syntx_owner_reconcile_media"), true);

    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        variant_id: "banana21-image-1k-minimal-square"
      }
    });
    const schemaOutput = schema.structuredContent as Record<string, unknown>;
    assert.equal(schemaOutput.schema_status, "live_verified");
    assert.equal(schemaOutput.schema_version, "1.0.0");
    assert.equal(schemaOutput.contract_schema_version, "2.0.0");
    assert.equal(schemaOutput.variant_id, "banana21-image-1k-minimal-square");

    const prompt = "private v2 stdio schema-validation fixture";
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        variant_id: "banana21-image-1k-minimal-square",
        parameters: { prompt, file_urls: [] }
      }
    });
    const validationOutput = validation.structuredContent as Record<string, unknown>;
    assert.equal(validationOutput.validation_status, "VALID");
    assert.equal(validationOutput.contract_schema_version, "2.0.0");
    assert.equal(validationOutput.variant_id, "banana21-image-1k-minimal-square");
    assert.equal(JSON.stringify(validation).includes(prompt), false);

    const noAuthGenerate = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_unlinked_v2_media_attempt01",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        variant_id: "banana21-image-1k-minimal-square",
        parameters: { prompt: "must-not-dispatch-without-auth", file_urls: [] }
      }
    });
    assert.equal(noAuthGenerate.isError, true);
    assert.match(JSON.stringify(noAuthGenerate), /AUTH_REQUIRED/u);
    assert.equal(JSON.stringify(noAuthGenerate).includes("must-not-dispatch-without-auth"), false);
  } finally {
    await client.close();
  }
});

test("owner stdio rejects unsupported schema selectors before server startup", async () => {
  const client = new Client({ name: "owner-contract-media-invalid-schema-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "latest",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json"
    },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("owner stdio does not fall back across schema-version namespaces", async () => {
  const client = new Client({ name: "owner-contract-media-v2-no-fallback-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0",
      SYNTX_GENERATION_CONTRACT_VERSION: "sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json"
    },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("owner contract-media opt-in refuses a non-version selector", async () => {
  const client = new Client({ name: "owner-contract-media-selector-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: {
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_VERSION: "latest"
    },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher rejects invalid account-status operator flag", async () => {
  const client = new Client({ name: "owner-invalid-flag-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_ACCOUNT_STATUS: "true" },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher registers real generation only with exact operator flag", async () => {
  const client = new Client({ name: "owner-generate-image-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_GENERATE_IMAGE: "1" },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      ...TOOL_NAMES, ...SYNTX_AUTH_TOOL_NAMES,
      SYNTX_MODEL_ACCESS_TOOL_NAME, SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME
    ]);
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_unknown_attempt_0000000000",
      prompt: "a small wooden lighthouse"
    } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AUTH_REQUIRED/u);
    assert.match(JSON.stringify(result), /A linked SYNTX account is required\./u);
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher rejects invalid generate-image operator flag", async () => {
  const client = new Client({ name: "owner-invalid-generate-flag-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_GENERATE_IMAGE: "true" },
    stderr: "pipe"
  });
  try {
    await assert.rejects(client.connect(transport as unknown as Transport));
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher registers video only with its separate exact operator flag", async () => {
  const client = new Client({ name: "owner-generate-video-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/src/transports/stdio-owner.js")],
    cwd: process.cwd(),
    env: { SYNTX_OWNER_GENERATE_VIDEO: "1" },
    stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.some((tool) => tool.name === SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME), true);
    assert.equal(listed.tools.some((tool) => tool.name === SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME), false);
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: "link_unknown_attempt_0000000000", prompt: "a short test" } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AUTH_REQUIRED/u);
    assert.match(JSON.stringify(result), /A linked SYNTX account is required\./u);
  } finally {
    await client.close();
  }
});

test("built owner stdio launcher rejects invalid generate-video operator flag", async () => {
  const client = new Client({ name: "owner-invalid-video-flag-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/src/transports/stdio-owner.js")], cwd: process.cwd(), env: { SYNTX_OWNER_GENERATE_VIDEO: "true" }, stderr: "pipe" });
  try { await assert.rejects(client.connect(transport as unknown as Transport)); }
  finally { await client.close(); }
});

function assertSafeInvalidAuthInput(result: CallToolResult): void {
  assert.equal(result.isError, true);
  const text = result.content.find((item) => item.type === "text");
  assert.equal(text?.type, "text");
  assert.deepEqual(JSON.parse(text.text) as unknown, {
    error: {
      code: "INVALID_TOOL_INPUT",
      message: "Tool input does not match the declared login schema."
    }
  });
  assert.equal(JSON.stringify(result).includes("Input validation error"), false);
}
