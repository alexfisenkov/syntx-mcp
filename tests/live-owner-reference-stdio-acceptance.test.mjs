import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/live-owner-reference-stdio-acceptance.mjs");
const CASE_152 = "banana21-reference-stdio-152";
const OLD_CASE_134 = "banana21-reference-stdio-134";
const PROMPT_152 = "Use this simple reference as a loose visual guide for a cobalt-blue paper kite with a short orange tail over a soft green hill at dusk. Make one square image with no text.";
const FILENAME_152 = "owner-reference-fixture-stdio-152.png";
const sha256 = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
let modulePromise;
const load = () => modulePromise ??= import(pathToFileURL(scriptPath).href);

test("CLI refuses without exact confirmation before creating an owner client", () => {
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5_000,
    env: { PATH: process.env.PATH ?? "" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /Refusing owner reference stdio acceptance/u);
});

test("acceptance args are an exact fixed-case guard", async () => {
  const module = await load();
  const confirmation = "--confirm-owner-image-reference-stdio-acceptance";
  const args = [confirmation, "--real", "--case", CASE_152];
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs(args);
  assert.ok(config);
  for (const invalid of [
    [],
    ["--real", ...args.slice(1)],
    [...args, "--prompt", "caller supplied"],
    [confirmation, "--real", "--case", "banana21-reference-512-v2"],
    [confirmation, "--mock", "--case", CASE_152],
    [confirmation, "--real", "--case", OLD_CASE_134]
  ]) assert.equal(module.parseOwnerImageReferenceStdioAcceptanceArgs(invalid), null);
});

test("historical case-134 fixture remains byte-pinned", async () => {
  const module = await load();
  const fixture = module.createOwnerImageReferenceStdioFixture();
  assert.equal(fixture.width, 512);
  assert.equal(fixture.height, 512);
  assert.ok(fixture.bytes.length > 0 && fixture.bytes.length < 7 * 1024 * 1024);
  assert.match(fixture.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(fixture.sha256, "sha256:d5ffcd7e51957f4c7b4eed9eae616c1cfbc2cb3dedecaadf9a056bd2937a5ac3");
  assert.equal(module.createOwnerImageReferenceStdioFixture().sha256, fixture.sha256);
  assert.notEqual(fixture.sha256, "sha256:4fdfab2aba1a6f6f62d7dd9c856f563d82504092ae3835a392c7a55af623c5a0");
});

test("case 152 uses a distinct deterministic 512 kite PNG, filename, and fixed prompt", async () => {
  const module = await load();
  const oldFixture = module.createOwnerImageReferenceStdioFixture();
  const fixture = module.createOwnerImageReferenceStdioFixture152();
  assert.equal(fixture.width, 512);
  assert.equal(fixture.height, 512);
  assert.equal(fixture.filename, FILENAME_152);
  assert.ok(fixture.bytes.length < 7 * 1024 * 1024);
  assert.match(fixture.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(fixture.sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.notEqual(fixture.sha256, oldFixture.sha256);
  assert.equal(module.OWNER_REFERENCE_STDIO_PROMPT_152, PROMPT_152);
  assert.equal(sha256(PROMPT_152), "sha256:d11483db05b201a9919d6a926cb858850ccc7ab09922d082e5796345addac17e");
});

test("default SDK owner client requires child close evidence and a null public pid", async () => {
  const module = await load();
  let transport;
  class FakeTransport {
    pid = 734;
    onclose;
    constructor(options) { this.options = options; transport = this; }
    async close() { this.pid = null; this.onclose?.(); }
  }
  class FakeClient {
    async connect(value) { transport = value; }
    async close() { transport.pid = null; transport.onclose?.(); }
  }
  const session = await module.createDefaultOwnerClient({
    command: process.execPath, args: ["dist/src/transports/stdio-owner.js"], cwd: process.cwd(),
    env: { SYNTX_OWNER_IMAGE_REFERENCES: "1", SYNTX_OWNER_ACCOUNT_STATUS: "1" }, stderr: "pipe"
  }, { Client: FakeClient, StdioClientTransport: FakeTransport });
  await session.client.close();
  assert.equal(transport.pid, null);
  assert.equal(await session.waitForExit(), true);

  class LivePidClient {
    async connect(value) { transport = value; }
    async close() { transport.onclose?.(); }
  }
  const notExited = await module.createDefaultOwnerClient({ command: process.execPath, args: [], cwd: process.cwd(), env: {}, stderr: "pipe" },
    { Client: LivePidClient, StdioClientTransport: FakeTransport });
  await notExited.client.close();
  assert.equal(await notExited.waitForExit(), false);
});

test("mock stock-stdio flow uses four normal tools, one upload and one generation, then revokes and closes", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const harness = fakeOwnerStdioHarness();
  const result = await module.runOwnerImageReferenceStdioAcceptance(config, harness.io, harness.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(result.result_mime, "image/jpeg");
  assert.equal(result.result_sha256, `sha256:${"a".repeat(64)}`);
  assert.equal(result.result_byte_size, 4096);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.stdout_includes_private_data, false);
  assert.equal(harness.toolArguments.find((value) => value.name === "syntx_owner_generate_reference_image").arguments.prompt, PROMPT_152);
  assert.equal(harness.toolArguments.find((value) => value.name === "syntx_upload_image_reference" && value.arguments.link_attempt_id === harness.attemptId).arguments.filename, FILENAME_152);
  assert.deepEqual(harness.requiredTools, [
    "syntx_upload_image_reference",
    "syntx_owner_generate_reference_image",
    "syntx_owner_reconcile_reference_image",
    "syntx_owner_list_reference_recovery"
  ]);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_upload_image_reference").length, 2); // one foreign-denial check + one accepted upload
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_owner_generate_reference_image").length, 1);
  assert.equal(harness.toolCalls.includes("syntx_owner_probe_image_reference"), false);
  assert.ok(harness.events.indexOf("foreign_denied") < harness.events.indexOf("begin"));
  const uploadIntent = harness.privateEvents.find((event) => event.event === "UPLOAD_INTENT");
  const generationIntent = harness.privateEvents.find((event) => event.event === "GENERATION_INTENT");
  assert.equal(uploadIntent.case_id, CASE_152);
  assert.equal(uploadIntent.fixture_sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.equal(uploadIntent.prompt_sha256, "sha256:d11483db05b201a9919d6a926cb858850ccc7ab09922d082e5796345addac17e");
  assert.equal(uploadIntent.upload_parameters_sha256, "sha256:fcfe1bd05c8563c8c4c672b59cc9d126e2891c621d7b32db87b84d63485c7cd4");
  assert.equal(uploadIntent.intent_fingerprint, "sha256:2dd41469b031eda8d683f666717707ad092b0e98700491b966c4973efa664a45");
  assert.equal(uploadIntent.upload_tool_parameters_sha256, "sha256:cdcc7a5c0cd3a87e3cfc48e54150f4fae34f90445b359da7f8faed82b4d13274");
  assert.equal(generationIntent.case_id, CASE_152);
  assert.equal(generationIntent.generation_parameters_sha256, "sha256:dd20c1cbc8f22af771aaa5a5fa744cd61d2fe95f19a556b75a1950875c38f29a");
  assert.equal(generationIntent.generation_tool_parameters_sha256, "sha256:98c8ceceb5b15fcc0a2f9e13d40442a226111527ef56b8ee68344524fcd1381b");
  assert.equal(uploadIntent.upload_call_count, 0);
  assert.equal(uploadIntent.generation_call_count, 0);
  assert.equal(generationIntent.upload_call_count, 1);
  assert.equal(generationIntent.generation_call_count, 0);
  assert.ok(harness.events.indexOf("client_close") < harness.events.indexOf("child_exit"));
});

test("unknown generation reconciles only the returned recovery handle in the same child", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const harness = fakeOwnerStdioHarness({ unknownGeneration: true });
  const result = await module.runOwnerImageReferenceStdioAcceptance(config, harness.io, harness.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_owner_generate_reference_image").length, 1);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_owner_reconcile_reference_image").length, 1);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_upload_image_reference").length, 2);
  assert.ok(harness.events.indexOf("reconcile") < harness.events.indexOf("client_close"));
  assert.equal(harness.events.filter((event) => event === "client_open").length, 1);
});

test("lost upload reply is UNKNOWN and never repeats upload or generation", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const harness = fakeOwnerStdioHarness({ uploadThrows: true });
  const result = await module.runOwnerImageReferenceStdioAcceptance(config, harness.io, harness.dependencies);
  assert.equal(result.status, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_upload_image_reference").length, 2);
  assert.equal(harness.toolCalls.filter((name) => name === "syntx_owner_generate_reference_image").length, 0);
});

test("lost generation reply uses one unique normal recovery record or stops on ambiguity", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const unique = fakeOwnerStdioHarness({ generationThrows: true, listedRecoveries: [recoveryRecord()] });
  const recovered = await module.runOwnerImageReferenceStdioAcceptance(config, unique.io, unique.dependencies);
  assert.equal(recovered.status, "PASS_EXACT_RESULT_ONLY");
  assert.equal(recovered.upload_call_count, 1);
  assert.equal(recovered.generation_call_count, 1);
  assert.equal(recovered.recovery_discovery_call_count, 1);
  assert.equal(recovered.recovery_call_count, 1);
  assert.equal(recovered.retry_count, 0);
  assert.equal(unique.toolCalls.filter((name) => name === "syntx_owner_generate_reference_image").length, 1);

  const ambiguous = fakeOwnerStdioHarness({ generationThrows: true,
    listedRecoveries: [recoveryRecord(), { ...recoveryRecord(), recovery_id: "recovery_00000000-0000-4000-8000-000000000135" }] });
  const held = await module.runOwnerImageReferenceStdioAcceptance(config, ambiguous.io, ambiguous.dependencies);
  assert.equal(held.status, "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE");
  assert.equal(held.generation_call_count, 1);
  assert.equal(held.recovery_discovery_call_count, 1);
  assert.equal(held.recovery_call_count, 0);
  assert.equal(held.retry_count, 0);
  assert.equal(ambiguous.toolCalls.filter((name) => name === "syntx_owner_reconcile_reference_image").length, 0);
  assert.equal(ambiguous.toolCalls.filter((name) => name === "syntx_owner_generate_reference_image").length, 1);
});

test("a failed private IPC emit aborts its registered approval waiter and still closes the child", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const harness = fakeOwnerStdioHarness();
  let waiterAborted = false;
  const readyWait = harness.dependencies.waitForPrivateAction;
  harness.dependencies.waitForPrivateAction = (event, context, timeoutMs, signal) => {
    if (event !== "UPLOAD_INTENT") return readyWait(event, context, timeoutMs, signal);
    return new Promise((resolve) => signal.addEventListener("abort", () => { waiterAborted = true; resolve(null); }, { once: true }));
  };
  harness.dependencies.sendPrivateIpc = async (message) => {
    if (message.event === "UPLOAD_INTENT") return false;
    harness.privateEvents.push(message);
    return true;
  };
  const result = await module.runOwnerImageReferenceStdioAcceptance(config, harness.io, harness.dependencies);
  assert.equal(waiterAborted, true);
  assert.equal(result.upload_call_count, 0);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.client_close_status, "CLOSED");
});

test("unknown upload stops before generation and cleanup failure remains visible", async () => {
  const module = await load();
  const config = module.parseOwnerImageReferenceStdioAcceptanceArgs([
    "--confirm-owner-image-reference-stdio-acceptance", "--real", "--case", CASE_152
  ]);
  const uploadUnknown = fakeOwnerStdioHarness({ unknownUpload: true });
  const uploadResult = await module.runOwnerImageReferenceStdioAcceptance(config, uploadUnknown.io, uploadUnknown.dependencies);
  assert.equal(uploadResult.status, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(uploadResult.upload_call_count, 1);
  assert.equal(uploadResult.generation_call_count, 0);
  assert.equal(uploadResult.retry_count, 0);
  assert.equal(uploadResult.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(uploadResult.client_close_status, "CLOSED");

  const cleanupFail = fakeOwnerStdioHarness({ unlinkFailure: true });
  const cleanupResult = await module.runOwnerImageReferenceStdioAcceptance(config, cleanupFail.io, cleanupFail.dependencies);
  assert.equal(cleanupResult.status, "PASS_CLEANUP_UNCONFIRMED");
  assert.equal(cleanupResult.local_unlink_status, "UNCONFIRMED");
  assert.equal(cleanupResult.client_close_status, "CLOSED");
  assert.equal(cleanupResult.generation_call_count, 1);
});

function fakeOwnerStdioHarness(options = {}) {
  const events = [];
  const toolCalls = [];
  const toolArguments = [];
  const privateEvents = [];
  const stdout = [];
  const attemptId = "link_fake_reference_stdio_attempt_000000000001";
  const recoveryId = "recovery_00000000-0000-4000-8000-000000000134";
  const referenceHandle = "reference_00000000-0000-4000-8000-000000000134";
  const requiredTools = [
    "syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
    "syntx_upload_image_reference", "syntx_owner_generate_reference_image",
    "syntx_owner_reconcile_reference_image", "syntx_owner_list_reference_recovery"
  ];
  let revoked = false;
  let listed = false;
  const client = {
    async listTools() { listed = true; events.push("list_tools"); return { tools: requiredTools.map((name) => ({ name })) }; },
    async callTool(request) {
      toolCalls.push(request.name);
      toolArguments.push({ name: request.name, arguments: { ...(request.arguments ?? {}) } });
      const args = request.arguments ?? {};
      if (request.name === "syntx_upload_image_reference" && args.link_attempt_id !== attemptId) {
        events.push("foreign_denied");
        return errorResult("REFERENCE_PRINCIPAL_NOT_LINKED");
      }
      if (request.name === "syntx_begin_login") {
        events.push("begin");
        return {
          structuredContent: { attempt_id: attemptId },
          content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000134" }]
        };
      }
      if (request.name === "syntx_check_login") return {
        structuredContent: { attempt_id: attemptId, status: revoked ? "REVOKED" : "LINKED", linked: !revoked }
      };
      if (request.name === "syntx_get_account_status") return { structuredContent: { subscription: { active: true, plan_type: "PAID" } } };
      if (request.name === "syntx_upload_image_reference") {
        events.push("upload");
        if (options.uploadThrows) throw new Error("lost upload reply");
        if (options.unknownUpload) return errorResult("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
        return { structuredContent: { status: "accepted", reference_handle: referenceHandle } };
      }
      if (request.name === "syntx_owner_generate_reference_image") {
        events.push("generate");
        if (options.generationThrows) throw new Error("lost generation reply");
        return options.unknownGeneration
          ? errorResult("OUTCOME_UNKNOWN", recoveryId)
          : { structuredContent: referenceResult() };
      }
      if (request.name === "syntx_owner_reconcile_reference_image") {
        assert.equal(args.recovery_id, recoveryId);
        events.push("reconcile");
        return { structuredContent: referenceResult() };
      }
      if (request.name === "syntx_owner_list_reference_recovery") {
        events.push("list_recovery");
        return { structuredContent: { recoveries: options.listedRecoveries ?? [] } };
      }
      if (request.name === "syntx_unlink") {
        if (options.unlinkFailure) return errorResult("AUTH_LINK_INVALID_STATE");
        revoked = true;
        return { structuredContent: { status: "REVOKED" } };
      }
      throw new Error(`unexpected tool ${request.name}`);
    },
    async close() { events.push("client_close"); }
  };
  const transport = { async close() { events.push("transport_close"); } };
  return {
    events,
    toolCalls,
    toolArguments,
    attemptId,
    privateEvents,
    stdout,
    requiredTools: requiredTools.slice(-4),
    io: { stdout: { write(value) { stdout.push(value); } } },
    dependencies: {
      isSourceCheckout: () => true,
      createOwnerClient: async (childOptions) => {
        assert.equal(childOptions.command, process.execPath);
        assert.deepEqual(childOptions.args, [resolve("dist/src/transports/stdio-owner.js")]);
        assert.deepEqual(childOptions.env, { SYNTX_OWNER_IMAGE_REFERENCES: "1", SYNTX_OWNER_ACCOUNT_STATUS: "1" });
        events.push("client_open");
        return { client, transport, async waitForExit() { events.push("child_exit"); return true; } };
      },
      sendPrivateIpc: async (message) => { privateEvents.push(message); return true; },
      waitForHandoffAck: async () => { events.push("handoff_ack"); return true; },
      waitForPrivateAction: async (event) => event === "FINISH_INTENT" ? { action: "finish" }
        : event === "RECOVERY_ACTION" ? { action: "reconcile" }
          : event === "BEGIN" ? { action: "handoff_sent" }
            : { action: event === "UPLOAD_INTENT" ? "approve_upload" : "approve_generation" },
      sleep: async () => undefined,
      observeOwnedImageArtifact: async ({ artifacts }) => {
        assert.equal(artifacts.length, 1);
        return { status: "OBSERVED", mime: "image/jpeg", byte_size: 4096, width: 1024, height: 1024, sha256: `sha256:${"a".repeat(64)}` };
      },
      loadReferenceSource: () => ({ registryVersion: "fixed", candidateSchemaHash: `sha256:${"b".repeat(64)}`, sourceFingerprint: `sha256:${"c".repeat(64)}` })
    }
  };
}

function recoveryRecord() {
  return { recovery_id: "recovery_00000000-0000-4000-8000-000000000134", model_id: "banana-2.1",
    operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square", created_at: "2026-10-09T00:00:00.000Z" };
}

function referenceResult() {
  return {
    model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square",
    status: "result_observed", confidence: { confidence_scope: "root126_exact_owner_reference_path" },
    artifacts: [{ url: "https://r2.syntx.ai/generated/private.jpg", mime_type: "image/jpeg" }]
  };
}

function errorResult(code, recoveryId) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } }) }] };
}
