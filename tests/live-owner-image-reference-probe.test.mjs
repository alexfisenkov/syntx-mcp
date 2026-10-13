import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  createOwnerImageReferenceFixture,
  OWNER_IMAGE_REFERENCE_CASE_ID,
  OWNER_IMAGE_REFERENCE_REGISTRY_VERSION,
  parseOwnerImageReferenceProbeArgs,
  runOwnerImageReferenceProbe
} from "../scripts/live-owner-image-reference-probe.mjs";
import { loadGenerationContractRegistryV2 } from "../dist/src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../dist/src/catalog/selected-discovery-catalog.js";
import { GenerationContractExecutorV2 } from "../dist/src/adapter/syntx/generation-contract-executor-v2.js";
import { OwnerContractMediaService } from "../dist/src/application/owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "../dist/src/application/owner-contract-media-recovery.js";
import { SyntxChatHttpClient } from "../dist/src/adapter/syntx/chat-http-client.js";

const ATTEMPT = "link_reference_probe_test_attempt_000000000001";
const BINDING = Object.freeze({ tenant_id: "tenant_reference_probe_test", subject: "subject_reference_probe_test" });
const OLD_CASE_ID = "banana21-reference-512";
const NEW_CASE_PROMPT = "Use the supplied reference image only as a gentle visual cue for a small red house between two green trees on a quiet hill under a clear sky. Create one square image with no text.";
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value) { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }
const CONFIG = parseOwnerImageReferenceProbeArgs([
  "--confirm-owner-image-reference-probe", "--real", "--registry-version", OWNER_IMAGE_REFERENCE_REGISTRY_VERSION,
  "--case", OWNER_IMAGE_REFERENCE_CASE_ID
]);

function fakeDependencies(options = {}) {
  const registry = loadGenerationContractRegistryV2(OWNER_IMAGE_REFERENCE_REGISTRY_VERSION);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const executor = new GenerationContractExecutorV2(registry, catalog);
  const recoveryStore = new OwnerContractMediaRecoveryStore();
  const service = new OwnerContractMediaService({ recoveryStore, wait: async () => undefined, imageTimeoutMs: 40 });
  const counts = { upload: 0, image: 0, ordinaryImage: 0, get: 0, modelAccess: 0, subscription: 0, unlink: 0, storeClosed: 0 };
  const events = [];
  const wireBodies = [];
  const uploadFilenames = [];
  let revoked = false;
  let recoveryListCalls = 0;
  const linkService = { async getStatus(_binding, attemptId) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
      status: options.foreignPrincipal ? "REVOKED" : revoked ? "REVOKED" : "LINKED",
      expires_at: null, linked: !options.foreignPrincipal && !revoked };
  } };
  const runtime = {
    application: {},
    authBinding: BINDING,
    authStore: { close() { counts.storeClosed += 1; } },
    linkService,
    catalog,
    serverOptions: { ownerContractMedia: { service, executor }, generationContractRegistryV2: registry },
    createReadClient() {
      return {
        async getSubscription() { counts.subscription += 1; return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null }; },
        async getModelInfo() {
          counts.modelAccess += 1;
          return { access: options.modelAccess !== false, cost: 0.35, discount_cost: 0.25,
            free_remaining_generations: 0, limit: 10, show_warning: false };
        }
      };
    },
    createChatClient() {
      const chatClient = {
        async uploadFileReferences(request) {
          counts.upload += 1;
          uploadFilenames.push(request.filename);
          assert.equal(request.filename, "owner-reference-fixture-v2.png");
          if (options.unknownUpload) throw new Error("upload receipt lost");
          return [{ url: "https://r2.syntx.ai/owned/reference-fixture.png" }];
        },
        async createChat() { return { chat_uuid: "reference-probe-chat" }; },
        async startImage() {
          counts.ordinaryImage += 1;
          throw new Error("ordinary image path is forbidden for references");
        },
        async startImageWithInternalReferences(baseRequest, references) {
          events.push({ event: "RAW_IMAGE_START" });
          counts.image += 1;
          if (baseRequest.settings.file_urls.length !== 0 || references.length !== 1 || references[0].url !== "https://r2.syntx.ai/owned/reference-fixture.png") {
            throw new Error("internal image reference boundary mismatch");
          }
          const wireBody = { chat_uuid: baseRequest.chat_uuid, prompt: baseRequest.prompt,
            settings: { ...baseRequest.settings, file_urls: references.map((reference) => ({ type: "image", url: reference.url })) } };
          wireBodies.push(wireBody);
          if (options.unknownGeneration) throw new Error("image receipt lost");
          if (options.realHttpClient) return options.realHttpClient.startImageWithInternalReferences(baseRequest, references);
          if (options.missingInternalPort) throw new Error("internal image port unavailable");
          return { chat_uuid: baseRequest.chat_uuid, message_id: "reference-probe-echo" };
        },
        async startVideo() { throw new Error("video dispatch forbidden"); },
        async getMessage(chatUuid, messageId) {
          counts.get += 1;
          return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1",
            artifacts: [{ url: "https://r2.syntx.ai/generated/result.jpg", mime_type: "image/jpeg" }] };
        },
        async listInProgress() {
          counts.get += 1;
          recoveryListCalls += 1;
          return options.recoverOnSecondRead && recoveryListCalls >= 2
            ? [{ message_id: "reference-probe-bot-result", object_type: "image", model_type: "banana-2.1" }]
            : [];
        }
      };
      if (options.missingInternalPort) delete chatClient.startImageWithInternalReferences;
      return chatClient;
    }
  };

  return {
    counts, events, wireBodies, uploadFilenames,
    runtime,
    dependencies: {
      createRuntime() { return runtime; },
      createMcpServer(_application, _serverOptions) {
        const server = new McpServer({ name: "reference-probe-test", version: "1.0.0" });
        server.registerTool("syntx_begin_login", { inputSchema: z.object({}) }, async () => ({
          content: [{ type: "resource_link", name: "Owner authorization", uri: "https://t.me/example" }],
          structuredContent: { attempt_id: ATTEMPT }
        }));
        server.registerTool("syntx_check_login", { inputSchema: z.object({ attempt_id: z.string() }) }, async () => ({
          structuredContent: { attempt_id: ATTEMPT, status: revoked ? "REVOKED" : "LINKED", linked: !revoked }
        }));
        server.registerTool("syntx_unlink", { inputSchema: z.object({ attempt_id: z.string() }) }, async () => {
          counts.unlink += 1;
          if (options.unlinkFailure) return { isError: true, content: [{ type: "text", text: "failed" }] };
          revoked = true;
          return { structuredContent: { status: "REVOKED" } };
        });
        server.registerTool("syntx_get_account_status", { inputSchema: z.object({ link_attempt_id: z.string() }) }, async () => ({
          structuredContent: { subscription: { active: true } }
        }));
        server.registerTool("syntx_get_generation_schema", { inputSchema: z.object({ model_id: z.string(), operation_id: z.string(), variant_id: z.string() }) }, async () => ({
          structuredContent: { model_id: "banana-2.1", variant_id: "banana21-image-1k-minimal-square", schema_status: "live_verified",
            schema_hash: "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d" }
        }));
        server.registerTool("syntx_validate_generation", { inputSchema: z.object({ model_id: z.string(), operation_id: z.string(), variant_id: z.string(), parameters: z.record(z.string(), z.unknown()) }) }, async () => ({
          structuredContent: { validation_status: "VALID", variant_id: "banana21-image-1k-minimal-square",
            schema_hash: "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d" }
        }));
        return server;
      },
      sendPrivateIpc: options.sendPrivateIpc ?? (async (message) => { events.push(message); return true; }),
      waitForHandoffAck: options.waitForHandoffAck ?? (async () => true),
      waitForParentAction: options.waitForParentAction,
      observeOwnedImageArtifact: async () => ({ status: "OBSERVED", mime: "image/jpeg", byte_size: 2048,
        width: 1024, height: 1024, sha256: `sha256:${"d".repeat(64)}` }),
      sleep: async () => undefined,
      ...(options.beforeProbeCall ? { beforeProbeCall: options.beforeProbeCall } : {})
    }
  };
}

test("CLI parser admits only the new pinned reference case; deterministic house PNG differs from Root 117", async () => {
  assert.ok(CONFIG);
  assert.equal(OWNER_IMAGE_REFERENCE_CASE_ID, "banana21-reference-512-v2");
  assert.equal(parseOwnerImageReferenceProbeArgs(["--confirm-owner-image-reference-probe", "--real", "--registry-version",
    OWNER_IMAGE_REFERENCE_REGISTRY_VERSION, "--case", OWNER_IMAGE_REFERENCE_CASE_ID, "--prompt", "anything"]), null);
  assert.equal(parseOwnerImageReferenceProbeArgs(["--confirm-owner-image-reference-probe", "--real", "--registry-version",
    OWNER_IMAGE_REFERENCE_REGISTRY_VERSION, "--case", OLD_CASE_ID]), null);
  let runtimeCreated = false;
  const oldCaseResult = await runOwnerImageReferenceProbe(null, {}, { createRuntime() { runtimeCreated = true; throw new Error("old case must stop first"); } });
  assert.equal(oldCaseResult.status, "CONFIRMATION_REQUIRED");
  assert.equal(runtimeCreated, false);
  const fixture = createOwnerImageReferenceFixture();
  assert.equal(fixture.width, 512);
  assert.equal(fixture.height, 512);
  assert.equal(fixture.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(fixture.sha256, "sha256:4fdfab2aba1a6f6f62d7dd9c856f563d82504092ae3835a392c7a55af623c5a0");
  assert.equal(createOwnerImageReferenceFixture().sha256, fixture.sha256);
  assert.notEqual(fixture.sha256, "sha256:13e919a306d249a252c1fde6448cf0ede4028d0bb373a062e24eb8495dcafcf1");
  assert.equal(sha256(NEW_CASE_PROMPT), "sha256:4ffdd303a565df21eb09b845b55ffa54f92cc1dd475f213b1c3c3c04def0d8f6");
  assert.notEqual(sha256(NEW_CASE_PROMPT), "sha256:323d44657e74d8b08ab2b0851da2b01607564b84799f2419a6c3306262b90e73");
  assert.ok(fixture.bytes.byteLength < 7 * 1024 * 1024);
});

test("mock end-to-end: one upload, one image POST, byte observation, and local auth cleanup", async () => {
  const fixture = fakeDependencies();
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY", JSON.stringify(result));
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.match(result.fixed_prompt_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.fixed_prompt_sha256, "sha256:4ffdd303a565df21eb09b845b55ffa54f92cc1dd475f213b1c3c3c04def0d8f6");
  assert.equal(result.intent_fingerprint, "sha256:cc40180fb4e766cb7437c7dfee68e62013586ee92389640967880102cdac18e9");
  assert.notEqual(result.intent_fingerprint, "sha256:254d141aec0b315b6e0caf027b8da07fea3bee07ef49a9a13298307a49906051");
  assert.ok(result.normalized_setting_fields.includes("file_urls"));
  assert.equal(result.result_mime, "image/jpeg");
  assert.equal(result.result_sha256, `sha256:${"d".repeat(64)}`);
  assert.match(result.actual_request_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(result.reference_entry_shape, { count: 1, keys: ["type", "url"], type: "image" });
  assert.ok(!JSON.stringify(result).includes("https://"));
  const requestLatch = fixture.events.findIndex((event) => event.event === "IMAGE_REQUEST_LATCHED");
  const rawDispatch = fixture.events.findIndex((event) => event.event === "RAW_IMAGE_START");
  assert.ok(requestLatch >= 0 && requestLatch < rawDispatch);
  assert.equal(result.candidate_status, "blocked");
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(fixture.counts.upload, 1);
  assert.deepEqual(fixture.uploadFilenames, ["owner-reference-fixture-v2.png"]);
  assert.equal(fixture.counts.image, 1);
  assert.equal(fixture.counts.ordinaryImage, 0);
  assert.deepEqual(fixture.wireBodies[0].settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/owned/reference-fixture.png" }]);
  assert.equal(result.predicted_wire_body_fingerprint, sha256(canonicalJson(fixture.wireBodies[0])));
  assert.equal(fixture.counts.unlink, 1);
  assert.equal(fixture.counts.storeClosed, 1);
});

test("unknown upload stops without generation or upload retry", async () => {
  const fixture = fakeDependencies({ unknownUpload: true });
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(fixture.counts.upload, 1);
  assert.equal(fixture.counts.image, 0);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
});

test("unknown generation receives one GET-only recovery attempt and never starts another image", async () => {
  const actions = ["reconcile", "reconcile", "finish"];
  const fixture = fakeDependencies({ unknownGeneration: true, recoverOnSecondRead: true,
    waitForParentAction: async () => {
      const action = actions.shift();
      return action === undefined ? null : { action };
    }
  });
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 2);
  assert.equal(result.retry_count, 0);
  assert.equal(fixture.counts.image, 1);
  assert.ok(fixture.counts.get > 0);
  assert.equal(result.finish_action, "RECEIVED");
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  const unknownEvents = fixture.events.filter((event) => event.event === "OUTCOME_UNKNOWN");
  assert.ok(unknownEvents.length >= 1);
  for (const event of unknownEvents) {
    assert.equal(event.status, "OUTCOME_UNKNOWN");
    assert.equal(event.upload_call_count, 1);
    assert.equal(event.generation_call_count, 1);
    assert.equal(event.mcp_probe_call_count, 1);
    assert.equal(event.retry_count, 0);
  }
});

test("missing internal image port fails before generation and never falls back to ordinary startImage", async () => {
  const fixture = fakeDependencies({ missingInternalPort: true });
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "PRE_DISPATCH_FAILED");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(fixture.counts.image, 0);
  assert.equal(fixture.counts.ordinaryImage, 0);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
});

test("real HTTP adapter fakefetch receives the exact predicted typed reference body once", async () => {
  const requests = [];
  const httpClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { return operation("fake-credential-not-sent-outside-fetch"); } },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "reference-probe-echo" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const fixture = fakeDependencies({ realHttpClient: httpClient });
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY", JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.syntx.ai/api/v1/design/generate?ai_name=banana");
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(requests[0].body.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/owned/reference-fixture.png" }]);
  assert.equal(result.predicted_wire_body_fingerprint, sha256(canonicalJson(requests[0].body)));
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(fixture.counts.ordinaryImage, 0);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
});

test("foreign principal and model-access denial stop before upload; expired permit stops before image POST", async () => {
  const foreign = fakeDependencies({ foreignPrincipal: true });
  const foreignResult = await runOwnerImageReferenceProbe(CONFIG, {}, foreign.dependencies);
  assert.equal(foreignResult.upload_call_count, 0);
  assert.equal(foreignResult.generation_call_count, 0);
  assert.equal(foreign.counts.image, 0);

  const denied = fakeDependencies({ modelAccess: false });
  const deniedResult = await runOwnerImageReferenceProbe(CONFIG, {}, denied.dependencies);
  assert.equal(deniedResult.upload_call_count, 0);
  assert.equal(deniedResult.generation_call_count, 0);
  assert.equal(denied.counts.image, 0);

  let clock = 1_000;
  const expired = fakeDependencies({ beforeProbeCall() { clock = 902_000; } });
  expired.dependencies.now = () => 1_000;
  expired.dependencies.permitNow = () => clock;
  const expiredResult = await runOwnerImageReferenceProbe(CONFIG, {}, expired.dependencies);
  assert.equal(expiredResult.upload_call_count, 1);
  assert.equal(expiredResult.generation_call_count, 0);
  assert.equal(expired.counts.image, 0);
});

test("cleanup failure is reported without an automatic generation retry", async () => {
  const fixture = fakeDependencies({ unlinkFailure: true });
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "PASS_EXACT_RESULT_ONLY");
  assert.equal(result.local_unlink_status, "UNCONFIRMED");
  assert.equal(fixture.counts.image, 1);
});

test("missing private handoff receipt acknowledgement stops before upload and generation", async () => {
  const fixture = fakeDependencies();
  fixture.dependencies.waitForHandoffAck = async () => false;
  const result = await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.equal(result.status, "HANDOFF_ACK_MISSING");
  assert.equal(result.upload_call_count, 0);
  assert.equal(result.generation_call_count, 0);
  assert.equal(fixture.counts.upload, 0);
  assert.equal(fixture.counts.image, 0);
});

test("handoff ACK waiter is registered before BEGIN emission", async () => {
  const order = [];
  const fixture = fakeDependencies({ sendPrivateIpc: async (message) => {
    if (message.event === "BEGIN") order.push("begin-emitted");
    return true;
  }, waitForHandoffAck: async () => { order.push("ack-waiter-registered"); return true; } });
  await runOwnerImageReferenceProbe(CONFIG, {}, fixture.dependencies);
  assert.ok(order.indexOf("ack-waiter-registered") >= 0);
  assert.ok(order.indexOf("ack-waiter-registered") < order.indexOf("begin-emitted"));
});
