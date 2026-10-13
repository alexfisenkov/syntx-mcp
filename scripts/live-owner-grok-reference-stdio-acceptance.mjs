#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { types } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OWNER_GROK_REFERENCE_PROFILE_VERSION = "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json";
export const OWNER_GROK_REFERENCE_PROFILE_SET_SHA256 = "sha256:0c03ca4e7a2cc82fed71cc4d32b28d1efc0799ca5b48cda2eb85958228cf7cec";
export const OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID = "grok-i2i-and-pro-access-readonly";
export const OWNER_GROK_REFERENCE_CASES = Object.freeze({
  "grok-i2i-one-1k-batch1": Object.freeze({
    case_id: "grok-i2i-one-1k-batch1", profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "1k", batch_size: 1,
    filename: "owner-grok-reference-stdio-229-i2i.png",
    prompt: "Use the synthetic color reference as a loose guide for a small amber glass lantern on a mint-green table. One image, no text."
  }),
  "grok-pro-one-1k-batch2": Object.freeze({
    case_id: "grok-pro-one-1k-batch2", profile_id: "grok-i2i-pro-reference-one-source-reviewed",
    schema_hash: "sha256:1e272333d2b7de276a433409a0e32a96fb984fb372495dabc4f08d5b788a7c5f",
    model_id: "grok_i2i_pro", reference_count: 1, resolution: "1k", batch_size: 2,
    filename: "owner-grok-reference-stdio-229-pro.png",
    prompt: "Use the synthetic color reference as a loose guide for a violet ceramic vase with one gold ring against a soft ivory studio wall. Return two images, no text."
  }),
  "grok-i2i-new-2k-batch1": Object.freeze({
    case_id: "grok-i2i-new-2k-batch1", profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "2k", batch_size: 1,
    filename: "owner-grok-reference-stdio-248-i2i-2k.png",
    prompt: "Use the geometric reference loosely to create a small cobalt-blue stair-step sculpture on a rust-orange pedestal against a pale yellow wall. One image, no lettering."
  }),
  "grok-i2i-prism-2k-batch1": Object.freeze({
    case_id: "grok-i2i-prism-2k-batch1", profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "2k", batch_size: 1,
    filename: "owner-grok-reference-stdio-262-prism-2k.png",
    prompt: "Create a small iridescent triangular prism paperweight casting a blue-violet split shadow on a charcoal desk. Restrained studio still life, no text."
  }),
  "grok-i2i-sundial-1k-batch1": Object.freeze({
    case_id: "grok-i2i-sundial-1k-batch1", profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "1k", batch_size: 1,
    filename: "owner-grok-reference-stdio-279-sundial-1k.png",
    prompt: "Create a small abstract orange sundial sculpture on a teal desk, with a clean geometric shadow. Restrained studio still life, no people or text."
  }),
  "grok-i2i-origami-2k-batch1": Object.freeze({
    case_id: "grok-i2i-origami-2k-batch1", profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "2k", batch_size: 1,
    filename: "owner-grok-reference-stdio-291-origami-2k.png",
    prompt: "Create a folded white origami paper plane resting diagonally on a violet desk, with crisp geometric edge shadows. Minimal studio still life, no people or text."
  })
});

export const OWNER_GROK_TOOL_NAMES = Object.freeze([
  "syntx_get_grok_reference_schema", "syntx_validate_grok_reference", "syntx_upload_grok_image_reference",
  "syntx_owner_generate_grok_reference", "syntx_owner_reconcile_grok_reference",
  "syntx_owner_list_grok_reference_recovery"
]);
const SAFE_UNKNOWN_PHASES = Object.freeze(["PRE_DISPATCH", "POST_CALL_STARTED", "POST_ACK_KNOWN", "HISTORY_GET",
  "HISTORY_WAIT", "HISTORY_BINDING", "RESULT_GET", "RESULT_WAIT", "RESULT_BINDING"]);
const SAFE_HISTORY_MATCHES = Object.freeze(["NOT_RUN", "NONE", "UNIQUE", "INVALID"]);
const SAFE_UPSTREAM_ERROR_CODES = new Set(["INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"]);
const SAFE_UNKNOWN_DIAGNOSTIC_KEYS = Object.freeze(["phase", "echo_ack_known", "history_get_eligible", "history_get_performed",
  "history_get_count", "history_get_count_capped", "history_match", "result_get_performed", "result_get_count",
  "result_get_count_capped", "result_binding_known", "upstream_error_code"]);

const CONFIRM_FLAG = "--confirm-owner-grok-reference-stdio-acceptance";
const REAL_FLAG = "--real";
const CASE_FLAG = "--case";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const PROFILE_ARCHIVE = join(PROJECT_ROOT, "catalog/owner-image-reference-profiles/v1", OWNER_GROK_REFERENCE_PROFILE_VERSION);
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^reference_[0-9a-f-]{36}$/u;
const RECOVERY = /^recovery_[0-9a-f-]{36}$/u;
const ACTION_WINDOW_MS = 15 * 60_000;
const BEGIN_ACK_MS = 45_000;
const TOOL_TIMEOUT_MS = 15_000;
const GENERATION_TIMEOUT_MS = 200_000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;
const LOGIN_POLL_MS = 2_500;
const OWNER_REFERENCE_ENV = Object.freeze({
  SYNTX_OWNER_GROK_IMAGE_REFERENCES: "1",
  SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION: OWNER_GROK_REFERENCE_PROFILE_VERSION,
  SYNTX_OWNER_ACCOUNT_STATUS: "1"
});
const configs = new WeakSet();

export function parseOwnerGrokReferenceStdioAcceptanceArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 || argv[1] !== REAL_FLAG || argv[2] !== CASE_FLAG) return null;
  const live = argv[0] === CONFIRM_FLAG && Object.hasOwn(OWNER_GROK_REFERENCE_CASES, argv[3]);
  const diagnostic = argv[0] === "--confirm-owner-grok-reference-access-diagnostic" && argv[3] === OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID;
  if (!live && !diagnostic) return null;
  const config = Object.freeze({ caseId: argv[3], mode: diagnostic ? "READONLY_GROK_ACCESS_DIAGNOSTIC" : "REAL_OWNER_GROK_REFERENCE_STDIO_ACCEPTANCE" });
  configs.add(config);
  return config;
}

export function parseOwnerGrokReferenceUnknownDiagnostic(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== SAFE_UNKNOWN_DIAGNOSTIC_KEYS.length ||
        keys.some((key) => typeof key !== "string" || !SAFE_UNKNOWN_DIAGNOSTIC_KEYS.includes(key) || !("value" in descriptors[key]))) return null;
    const data = Object.create(null);
    for (const key of keys) data[key] = descriptors[key].value;
    if (!SAFE_UNKNOWN_PHASES.includes(data.phase) || !SAFE_HISTORY_MATCHES.includes(data.history_match) ||
        ![true, false].includes(data.echo_ack_known) || ![true, false].includes(data.history_get_eligible) ||
        ![true, false].includes(data.history_get_performed) || !Number.isSafeInteger(data.history_get_count) ||
        data.history_get_count < 0 || data.history_get_count > 255 || ![true, false].includes(data.history_get_count_capped) ||
        ![true, false].includes(data.result_get_performed) || !Number.isSafeInteger(data.result_get_count) ||
        data.result_get_count < 0 || data.result_get_count > 255 || ![true, false].includes(data.result_get_count_capped) ||
        ![true, false].includes(data.result_binding_known) ||
        !(data.upstream_error_code === null || SAFE_UPSTREAM_ERROR_CODES.has(data.upstream_error_code))) return null;
    return Object.freeze(Object.fromEntries(SAFE_UNKNOWN_DIAGNOSTIC_KEYS.map((key) => [key, data[key]])));
  } catch { return null; }
}

export function createOwnerGrokReferenceFixture(caseId) {
  const descriptor = OWNER_GROK_REFERENCE_CASES[caseId];
  if (!descriptor) throw new Error("FIXED_CASE_REQUIRED");
  const width = 512, height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const pixelRows = [];
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let color;
      if (caseId === "grok-i2i-one-1k-batch1") {
        color = y < 256 ? [95 + (x % 70), 142 + (y % 50), 173 + (x % 35), 255] : [103, 177, 137, 255];
        if ((x - 248) ** 2 + (y - 236) ** 2 < 92 ** 2) color = [213, 153, 59, 255];
        if (x >= 226 && x <= 270 && y >= 230 && y <= 360) color = [228, 171, 67, 255];
        if (x >= 214 && x <= 282 && y >= 348 && y <= 365) color = [66, 83, 102, 255];
      } else if (caseId === "grok-i2i-new-2k-batch1") {
        color = y < 320 ? [245, 224 + Math.floor(y / 32), 152, 255] : [236, 222, 179, 255];
        if (x >= 132 && x <= 380 && y >= 370 && y <= 430) color = [180, 78, 48, 255];
        if (x >= 157 && x <= 355 && y >= 334 && y <= 369) color = [46, 87, 161, 255];
        if (x >= 183 && x <= 329 && y >= 285 && y <= 333) color = [58, 104, 184, 255];
        if (x >= 211 && x <= 301 && y >= 225 && y <= 284) color = [71, 119, 198, 255];
        if (x >= 235 && x <= 277 && y >= 185 && y <= 224) color = [88, 137, 211, 255];
        if (x >= 244 && x <= 267 && y >= 185 && y <= 223) color = [35, 70, 139, 255];
      } else if (caseId === "grok-i2i-prism-2k-batch1") {
        color = y < 300 ? [31 + Math.floor(x / 128), 35 + Math.floor(y / 48), 48 + Math.floor(x / 64), 255]
          : [75 + Math.floor((y - 300) / 12), 67 + Math.floor((y - 300) / 20), 74 + Math.floor((x + y) / 90), 255];
        if (x >= 220 && x <= 365 && y >= 293 && y <= 311) color = [38, 42, 54, 255];
        if (y >= 135 && y <= 300) {
          const halfWidth = Math.floor((y - 135) * 0.58);
          const left = 256 - halfWidth, right = 256 + halfWidth;
          const facet = 256 + Math.floor((y - 135) * 0.12);
          if (x >= left && x <= right) color = x <= facet ? [66, 177, 208, 255] : [166, 101, 225, 255];
          if (x >= facet - 2 && x <= facet + 2 && x >= left && x <= right) color = [218, 221, 247, 255];
        }
        if (x >= 282 && x <= 360 && y >= 300 && y <= 323 && x - 282 <= (y - 300) * 3) color = [40, 42, 59, 255];
      } else if (caseId === "grok-i2i-sundial-1k-batch1") {
        color = y < 324 ? [42 + Math.floor(x / 128), 128 + Math.floor(y / 24), 128 + Math.floor(x / 100), 255]
          : [20 + Math.floor(x / 160), 87 + Math.floor((y - 324) / 8), 94 + Math.floor(x / 128), 255];
        const dx = x - 256, dy = y - 246, radiusSquared = dx * dx + dy * dy;
        if (radiusSquared >= 80 ** 2 && radiusSquared <= 91 ** 2) color = [243, 157, 70, 255];
        if (radiusSquared < 80 ** 2) color = [218 + Math.floor((x + y) / 80), 105 + Math.floor(x / 90), 43, 255];
        if (radiusSquared < 7 ** 2) color = [249, 199, 106, 255];
        if (y >= 160 && y <= 247 && Math.abs(x - 256) <= Math.floor((247 - y) * 0.31)) color = [245, 205, 133, 255];
        if (y >= 248 && y <= 335 && Math.abs(x - 256) <= Math.floor((y - 247) * 0.24)) color = [34, 62, 70, 255];
        if (x >= 128 && x <= 384 && y >= 346 && y <= 355) color = [29, 70, 76, 255];
      } else if (caseId === "grok-i2i-origami-2k-batch1") {
        color = y < 320 ? [77 + Math.floor(x / 100), 40 + Math.floor(y / 34), 118 + Math.floor((x + y) / 120), 255]
          : [48 + Math.floor(x / 128), 31 + Math.floor((y - 320) / 30), 84 + Math.floor(x / 100), 255];
        if (y >= 336 && y <= 353 && x >= 138 && x <= 394) color = [34, 24, 63, 255];
        if (y >= 130 && y <= 340 && x >= 125 && x <= 389 && x <= 256 + Math.floor((340 - y) * 0.78)) {
          color = [229, 226, 239, 255];
        }
        if (y >= 130 && y <= 340 && x >= 256 + Math.floor((340 - y) * 0.78) && x <= 389 - Math.floor((y - 130) * 0.58)) {
          color = [198, 198, 220, 255];
        }
        if (y >= 130 && y <= 340 && Math.abs(x - (256 - Math.floor((340 - y) * 0.78))) <= 3) color = [247, 244, 250, 255];
        if (y >= 130 && y <= 340 && Math.abs(x - (256 + Math.floor((340 - y) * 0.78))) <= 3) color = [173, 173, 202, 255];
        if (y >= 244 && y <= 340 && Math.abs(x - 256) <= Math.floor((y - 244) * 0.82)) color = [238, 236, 246, 255];
      } else {
        color = y < 300 ? [137 + (x % 45), 116 + (y % 44), 188 + (x % 32), 255] : [222, 213, 191, 255];
        if (Math.abs(x - 256) + Math.abs(y - 260) < 120) color = [121, 77, 164, 255];
        if (y >= 180 && y <= 330 && Math.abs(x - 256) <= Math.floor((y - 160) * 0.32)) color = [132, 86, 171, 255];
        if (y >= 225 && y <= 244 && Math.abs(x - 256) <= 75) color = [207, 157, 65, 255];
        if (y >= 327 && y <= 350 && Math.abs(x - 256) <= 98) color = [94, 74, 101, 255];
      }
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
    }
    pixelRows.push(raw.subarray(row + 1, row + 1 + width * 4));
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== width * height * 4 || bytes.length >= 7 * 1024 * 1024) {
    throw new Error("GROK_FIXTURE_INVALID");
  }
  const rgbaPixels = Buffer.concat(pixelRows);
  return Object.freeze({ bytes, width, height, filename: descriptor.filename, mimeType: "image/png",
    sha256: sha256(bytes), pixel_sha256: sha256(rgbaPixels), runtime_node_version: process.versions.node });
}

/** Pure shared builder for the exact safe metadata and action fingerprint sent in private ACK intents. */
export function buildOwnerGrokReferenceSafeIntentMetadata({ caseId, fixture, source, harnessSha256 }) {
  const descriptor = OWNER_GROK_REFERENCE_CASES[caseId];
  if (!descriptor || !fixture || !Buffer.isBuffer(fixture.bytes) || !sourceMatchesPinnedCase(source, descriptor) ||
      !/^sha256:[a-f0-9]{64}$/u.test(harnessSha256 ?? "") ||
      fixture.filename !== descriptor.filename || fixture.mimeType !== "image/png" || fixture.width !== 512 || fixture.height !== 512 ||
      sha256(fixture.bytes) !== fixture.sha256 || !/^sha256:[a-f0-9]{64}$/u.test(fixture.pixel_sha256 ?? "") ||
      typeof fixture.runtime_node_version !== "string") {
    throw new Error("SAFE_INTENT_METADATA_INVALID");
  }
  const promptHash = sha256(Buffer.from(descriptor.prompt, "utf8"));
  const safeBase = Object.freeze({ case_id: descriptor.case_id, profile_id: descriptor.profile_id, model_id: descriptor.model_id,
    profile_version: source.version, profile_set_sha256: source.profile_set_sha256, schema_hash: descriptor.schema_hash,
    catalog_version: source.catalog_version, source_fingerprint: source.source_fingerprint,
    fixture_sha256: fixture.sha256, fixture_width: fixture.width, fixture_height: fixture.height,
    fixture_pixel_sha256: fixture.pixel_sha256, fixture_byte_size: fixture.bytes.length,
    runtime_node_version: fixture.runtime_node_version, prompt_sha256: promptHash, harness_sha256: harnessSha256,
    requested_resolution: descriptor.resolution, requested_batch_size: descriptor.batch_size });
  const actionFingerprint = sha256(Buffer.from(canonicalJson({ ...safeBase, prompt_sha256: promptHash,
    settings: { resolution: descriptor.resolution, batch_size: descriptor.batch_size }, reference_count: descriptor.reference_count }), "utf8"));
  return Object.freeze({ safeBase, actionFingerprint });
}

/** Uses only the exact archived source epoch; no search, fallback, or runtime promotion. */
export async function loadOwnerGrokReferenceSource() {
  const [{ loadSelectedDiscoveryCatalog }, { loadOwnerGrokImageReferenceProfileSetV1 }, { getOwnerGrokImageReferenceProfile }] = await Promise.all([
    import("../dist/src/catalog/selected-discovery-catalog.js"),
    import("../dist/src/catalog/owner-grok-image-reference-profile-history.js"),
    import("../dist/src/catalog/owner-grok-image-reference-profiles.js")
  ]);
  const selected = loadSelectedDiscoveryCatalog();
  const set = loadOwnerGrokImageReferenceProfileSetV1(OWNER_GROK_REFERENCE_PROFILE_VERSION, selected.discoveryCatalog);
  const schemas = Object.fromEntries(Object.values(OWNER_GROK_REFERENCE_CASES).map((item) => [
    item.profile_id, getOwnerGrokImageReferenceProfile(set, item.profile_id).schema_hash
  ]));
  return Object.freeze({
    version: OWNER_GROK_REFERENCE_PROFILE_VERSION,
    profile_set_sha256: set.profile_set_sha256,
    catalog_version: set.catalog_version,
    schema_hashes: Object.freeze(schemas),
    source_fingerprint: sha256(Buffer.from(canonicalJson({ version: OWNER_GROK_REFERENCE_PROFILE_VERSION,
      profile_set_sha256: set.profile_set_sha256, catalog_version: set.catalog_version, schema_hashes: schemas }), "utf8"))
  });
}

export async function runOwnerGrokReferenceStdioAcceptance(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !configs.has(config)) return summary("CONFIRMATION_REQUIRED");
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) return summary("SOURCE_CHECKOUT_REQUIRED");
  if (config.mode === "READONLY_GROK_ACCESS_DIAGNOSTIC") return runOwnerGrokReferenceAccessDiagnostic(config, io, dependencies);
  const descriptor = OWNER_GROK_REFERENCE_CASES[config.caseId];
  if (!descriptor) return summary("FIXED_CASE_REQUIRED");
  const privateSend = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitAction = dependencies.waitForPrivateAction ?? (io === process
    ? (event, context, timeout, signal) => defaultWaitForPrivateAction(io, event, context, timeout, signal) : null);
  if (typeof privateSend !== "function" || typeof waitAction !== "function") return summary("PRIVATE_IPC_REQUIRED");

  const fixture = createOwnerGrokReferenceFixture(config.caseId);
  const source = await (dependencies.loadGrokReferenceSource ?? loadOwnerGrokReferenceSource)();
  if (!sourceMatchesPinnedCase(source, descriptor)) return summary("PROFILE_SOURCE_PIN_MISMATCH");
  const counts = { upload_call_count: 0, generation_call_count: 0, recovery_call_count: 0,
    recovery_discovery_call_count: 0, retry_count: 0, artifact_observation_count: 0 };
  const { safeBase, actionFingerprint } = buildOwnerGrokReferenceSafeIntentMetadata({ caseId: config.caseId, fixture, source,
    harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) });
  let session;
  let attemptId = null;
  let beginAcknowledged = false;
  let beginIntentFingerprint = null;
  let localUnlink = "NOT_ATTEMPTED";
  let clientClose = "NOT_ATTEMPTED";
  let operation = { status: "NOT_STARTED", artifacts: [] };
  let listedToolNames = [];
  try {
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath, args: [SERVER_PATH], cwd: PROJECT_ROOT, env: OWNER_REFERENCE_ENV, stderr: "pipe"
    }, dependencies.sdk ?? {});
    const listed = await callToolList(session.client);
    listedToolNames = [...new Set(listed?.tools?.map((tool) => tool.name) ?? [])].sort();
    if (!requiredToolSurfaceIsExact(listedToolNames)) throw new Error("REQUIRED_TOOL_SURFACE_INVALID");

    const schema = await callTool(session.client, "syntx_get_grok_reference_schema", { profile_id: descriptor.profile_id }, TOOL_TIMEOUT_MS);
    const validation = await callTool(session.client, "syntx_validate_grok_reference", {
      profile_id: descriptor.profile_id, reference_count: 1,
      parameters: { prompt: descriptor.prompt, resolution: descriptor.resolution, batch_size: descriptor.batch_size }
    }, TOOL_TIMEOUT_MS);
    if (!schemaMatches(schema, descriptor, source) || !validationMatches(validation, descriptor, source)) throw new Error("PROFILE_SCHEMA_READBACK_MISMATCH");

    const begun = await callTool(session.client, "syntx_begin_login", {}, TOOL_TIMEOUT_MS);
    attemptId = safeId(begun?.structuredContent?.attempt_id, ATTEMPT);
    const handoffUri = begun?.content?.find((part) => part.type === "resource_link")?.uri;
    if (begun?.isError === true || !attemptId || !isSafeHandoffUri(handoffUri)) throw new Error("BEGIN_UNAVAILABLE");
    beginIntentFingerprint = sha256(Buffer.from(canonicalJson({ attempt_id: attemptId, case_id: descriptor.case_id,
      profile_id: descriptor.profile_id, source_fingerprint: source.source_fingerprint }), "utf8"));
    beginAcknowledged = (await waitAndEmit(waitAction, "BEGIN", { attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint }, BEGIN_ACK_MS,
      () => emitPrivate(privateSend, "BEGIN", { attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint,
        handoff_uri: handoffUri, ...safeBase })))?.action === "handoff_sent";
    if (!beginAcknowledged) throw new Error("BEGIN_ACK_MISSING");
    if (!await pollLinked(session.client, attemptId, dependencies)) throw new Error("AUTH_NOT_LINKED");
    const account = await callTool(session.client, "syntx_get_account_status", { link_attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    if (!isActivePaidAccount(account)) throw new Error("SUBSCRIPTION_NOT_VERIFIED");
    await emitPrivate(privateSend, "PREFLIGHT", { ...safeBase, account_status: "ACTIVE_READBACK", mutation_counts: { ...counts } });

    operation = await runFixedCase({ client: session.client, attemptId, descriptor, fixture, source, safeBase,
      actionFingerprint, waitAction, privateSend, dependencies, counts });
  } catch (error) {
    operation = { status: statusForError(error), failure_stage: "HARNESS", failure_code: safeFailureCode(error), artifacts: [] };
  } finally {
    if (attemptId && session?.client) localUnlink = await unlinkAndReadBack(session.client, attemptId);
    if (session) {
      try { await session.client.close(); clientClose = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED"; }
      catch { clientClose = "UNCONFIRMED"; }
    }
  }
  if (operation.status === "PASS_FIXED_CASE_RESULT_ONLY" && (localUnlink !== "REVOKED_READBACK_CONFIRMED" || clientClose !== "CLOSED")) {
    operation = { ...operation, status: "PASS_CLEANUP_UNCONFIRMED" };
  }
  const observed = operation.artifacts ?? [];
  const result = {
    ...counts, case_id: descriptor.case_id, profile_id: descriptor.profile_id, model_id: descriptor.model_id,
    profile_version: source.version, profile_set_sha256: source.profile_set_sha256, schema_hash: descriptor.schema_hash,
    catalog_version: source.catalog_version, source_fingerprint: source.source_fingerprint, harness_sha256: safeBase.harness_sha256,
    request_fingerprint: operation.request_fingerprint ?? null, intent_fingerprint: actionFingerprint,
    begin_intent_fingerprint: beginIntentFingerprint,
    fixture_sha256: fixture.sha256, fixture_width: fixture.width, fixture_height: fixture.height,
    requested_resolution: descriptor.resolution, requested_batch_size: descriptor.batch_size,
    actual_result_count: operation.actual_result_count ?? null,
    mime_confidence: operation.mime_confidence ?? null, artifacts: observed,
    failure_stage: operation.failure_stage ?? null, failure_code: operation.failure_code ?? null,
    status: operation.status, local_unlink_status: localUnlink, client_close_status: clientClose,
    begin_acknowledged: beginAcknowledged, tool_surface_exact: requiredToolSurfaceIsExact(listedToolNames)
  };
  const serialized = JSON.stringify(result);
  result.stdout_includes_private_data = serialized.includes("https://") || serialized.includes(descriptor.prompt) ||
    serialized.includes(fixture.bytes.toString("base64")) || (attemptId !== null && serialized.includes(attemptId)) ||
    serialized.includes("reference_00000000-") || serialized.includes("recovery_00000000-");
  const unknownDiagnostic = parseOwnerGrokReferenceUnknownDiagnostic(operation.unknown_diagnostic);
  if (operation.status.startsWith("GENERATION_OUTCOME_UNKNOWN") && unknownDiagnostic !== null) {
    result.unknown_diagnostic = unknownDiagnostic;
  }
  return summary(result.status, result);
}

/** Diagnostic path is read-only; it cannot reach the upload or generation helpers. */
async function runOwnerGrokReferenceAccessDiagnostic(config, io, dependencies) {
  if (config.caseId !== OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID) return summary("FIXED_CASE_REQUIRED");
  const privateSend = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitAction = dependencies.waitForPrivateAction ?? (io === process
    ? (event, context, timeout, signal) => defaultWaitForPrivateAction(io, event, context, timeout, signal) : null);
  if (typeof privateSend !== "function" || typeof waitAction !== "function") return summary("PRIVATE_IPC_REQUIRED");
  const source = await (dependencies.loadGrokReferenceSource ?? loadOwnerGrokReferenceSource)();
  const cases = Object.values(OWNER_GROK_REFERENCE_CASES);
  if (!cases.every((descriptor) => sourceMatchesPinnedCase(source, descriptor))) return summary("PROFILE_SOURCE_PIN_MISMATCH");
  const descriptors = cases.filter((descriptor, index, all) =>
    all.findIndex((candidate) => candidate.profile_id === descriptor.profile_id) === index);
  const readCounts = { schema: 0, validate: 0, account: 0, model_access: 0, upload: 0, generate: 0, create_chat: 0 };
  const models = [];
  const safeSource = Object.freeze({ diagnostic_case_id: OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID,
    profile_version: source.version, profile_set_sha256: source.profile_set_sha256, catalog_version: source.catalog_version,
    source_fingerprint: source.source_fingerprint, harness_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) });
  let session;
  let attemptId = null;
  let beginIntentFingerprint = null;
  let beginAcknowledged = false;
  let status = "NOT_STARTED";
  let failureCode = null;
  let unlinkStatus = "NOT_ATTEMPTED";
  let clientCloseStatus = "NOT_ATTEMPTED";
  let toolNames = [];
  try {
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath, args: [SERVER_PATH], cwd: PROJECT_ROOT, env: OWNER_REFERENCE_ENV, stderr: "pipe"
    }, dependencies.sdk ?? {});
    const listed = await callToolList(session.client);
    toolNames = [...new Set(listed?.tools?.map((tool) => tool.name) ?? [])].sort();
    if (!requiredReadOnlyDiagnosticToolSurfaceIsExact(toolNames)) throw new Error("READONLY_DIAGNOSTIC_TOOL_SURFACE_INVALID");
    for (const descriptor of descriptors) {
      const schema = await callTool(session.client, "syntx_get_grok_reference_schema", { profile_id: descriptor.profile_id }, TOOL_TIMEOUT_MS);
      readCounts.schema += 1;
      const validation = await callTool(session.client, "syntx_validate_grok_reference", {
        profile_id: descriptor.profile_id, reference_count: 1,
        parameters: { prompt: descriptor.prompt, resolution: descriptor.resolution, batch_size: descriptor.batch_size }
      }, TOOL_TIMEOUT_MS);
      readCounts.validate += 1;
      if (!schemaMatches(schema, descriptor, source) || !validationMatches(validation, descriptor, source)) {
        throw new Error("PROFILE_SCHEMA_READBACK_MISMATCH");
      }
    }
    const begun = await callTool(session.client, "syntx_begin_login", {}, TOOL_TIMEOUT_MS);
    attemptId = safeId(begun?.structuredContent?.attempt_id, ATTEMPT);
    const handoffUri = begun?.content?.find((part) => part.type === "resource_link")?.uri;
    if (begun?.isError === true || !attemptId || !isSafeHandoffUri(handoffUri)) throw new Error("BEGIN_UNAVAILABLE");
    beginIntentFingerprint = sha256(Buffer.from(canonicalJson({ attempt_id: attemptId, diagnostic_case_id: config.caseId,
      profile_set_sha256: source.profile_set_sha256, source_fingerprint: source.source_fingerprint }), "utf8"));
    beginAcknowledged = (await waitAndEmit(waitAction, "BEGIN", { attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint }, BEGIN_ACK_MS,
      () => emitPrivate(privateSend, "BEGIN", { ...safeSource, attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint,
        handoff_uri: handoffUri })))?.action === "handoff_sent";
    if (!beginAcknowledged) throw new Error("BEGIN_ACK_MISSING");
    if (!await pollLinked(session.client, attemptId, dependencies)) throw new Error("AUTH_NOT_LINKED");
    const account = await callTool(session.client, "syntx_get_account_status", { link_attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    readCounts.account += 1;
    if (!isActivePaidAccount(account)) throw new Error("SUBSCRIPTION_NOT_VERIFIED");

    let anyModelAccessFailure = false;
    const costModes = descriptors.flatMap((descriptor) => [
      { descriptor, mode: "EMPTY", costParameters: {} },
      { descriptor, mode: "EXPLICIT_BATCH", costParameters: { batch_size: descriptor.batch_size } }
    ]);
    for (const { descriptor, mode, costParameters } of costModes) {
      let response;
      readCounts.model_access += 1;
      try {
        response = await callTool(session.client, "syntx_get_model_access", {
          link_attempt_id: attemptId, model_id: descriptor.model_id, cost_parameters: costParameters
        }, TOOL_TIMEOUT_MS);
      } catch {
        anyModelAccessFailure = true;
        models.push(Object.freeze({ model_id: descriptor.model_id, cost_parameters_mode: mode, status: "READ_FAILED", allowed: null,
          cost_status: "NOT_READ", known_nonnull_cost: false, unit_present: false, failure_code: "TRANSPORT_REPLY_LOST" }));
        continue;
      }
      if (response?.isError === true) {
        anyModelAccessFailure = true;
        models.push(Object.freeze({ model_id: descriptor.model_id, cost_parameters_mode: mode, status: "READ_FAILED", allowed: null,
          cost_status: "NOT_READ", known_nonnull_cost: false, unit_present: false, failure_code: parseToolError(response).code }));
        continue;
      }
      const value = response?.structuredContent;
      const expectedKeys = mode === "EMPTY" ? [] : ["batch_size"];
      const exactBinding = value?.account_read_live === true && value.model_id === descriptor.model_id &&
        value.model_type === descriptor.model_id && value.ai_name === "grok_image" &&
        value.catalog_version === source.catalog_version && value.parameters_redacted === true &&
        Array.isArray(value.parameter_keys) && canonicalJson(value.parameter_keys) === canonicalJson(expectedKeys);
      if (!exactBinding || ![true, false, null].includes(value.access) ||
          !(value.cost === null || typeof value.cost === "number") || !(value.discount_cost === null || typeof value.discount_cost === "number")) {
        anyModelAccessFailure = true;
        models.push(Object.freeze({ model_id: descriptor.model_id, cost_parameters_mode: mode, status: "MODEL_BINDING_MISMATCH", allowed: null,
          cost_status: "NOT_REPORTED", known_nonnull_cost: false, unit_present: false, failure_code: "MODEL_BINDING_MISMATCH" }));
        continue;
      }
      // The public ModelAccessResult schema contains numeric cost fields but no currency/unit field.
      const knownNonNullCost = value.cost !== null;
      models.push(Object.freeze({ model_id: descriptor.model_id, cost_parameters_mode: mode,
        status: value.access === true ? "READ_ALLOWED" : value.access === false ? "READ_DENIED" : "ACCESS_UNKNOWN",
        allowed: value.access, cost_status: knownNonNullCost ? "NONNULL_UNIT_UNSPECIFIED_NOT_REPORTED" : "NULL_UNKNOWN",
        known_nonnull_cost: knownNonNullCost, unit_present: false, failure_code: null }));
    }
    status = anyModelAccessFailure ? "MODEL_ACCESS_READ_FAILED" : "PASS_READONLY_ACCESS_DIAGNOSTIC";
  } catch (error) {
    status = statusForError(error);
    failureCode = safeFailureCode(error) ?? status;
  } finally {
    if (attemptId && session?.client) unlinkStatus = await unlinkAndReadBack(session.client, attemptId);
    if (session) {
      try { await session.client.close(); clientCloseStatus = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED"; }
      catch { clientCloseStatus = "UNCONFIRMED"; }
    }
  }
  if (status === "PASS_READONLY_ACCESS_DIAGNOSTIC" && (unlinkStatus !== "REVOKED_READBACK_CONFIRMED" || clientCloseStatus !== "CLOSED")) {
    status = "PASS_CLEANUP_UNCONFIRMED";
  }
  const result = { ...safeSource, status, failure_code: failureCode, begin_acknowledged: beginAcknowledged,
    models: Object.freeze(models), read_counts: Object.freeze(readCounts), local_unlink_status: unlinkStatus,
    client_close_status: clientCloseStatus, tool_surface_exact: requiredReadOnlyDiagnosticToolSurfaceIsExact(toolNames),
    mutation_calls: Object.freeze({ upload: 0, generation: 0, create_chat: 0 }) };
  const serialized = JSON.stringify(result);
  result.stdout_includes_private_data = serialized.includes("https://") || (attemptId !== null && serialized.includes(attemptId)) ||
    serialized.includes("balance") || serialized.includes("available");
  return summary(status, result);
}

async function runFixedCase({ client, attemptId, descriptor, fixture, source, safeBase, actionFingerprint,
  waitAction, privateSend, dependencies, counts }) {
  const uploadArgs = { profile_id: descriptor.profile_id, link_attempt_id: attemptId, content_base64: fixture.bytes.toString("base64"),
    filename: fixture.filename, mime_type: fixture.mimeType };
  const uploadHash = sha256(Buffer.from(canonicalJson({ profile_id: descriptor.profile_id, attemptId,
    filename: fixture.filename, mime_type: fixture.mimeType, fixture_sha256: fixture.sha256 }), "utf8"));
  if (!await waitAndEmit(waitAction, "UPLOAD_INTENT", { attempt_id: attemptId, intent_fingerprint: actionFingerprint }, ACTION_WINDOW_MS,
    () => emitPrivate(privateSend, "UPLOAD_INTENT", { ...safeBase, attempt_id: attemptId,
      intent_fingerprint: actionFingerprint, upload_parameters_sha256: uploadHash,
      upload_call_count: 0, generation_call_count: 0, retry_count: 0 }))) return { status: "UPLOAD_NOT_APPROVED", artifacts: [] };
  counts.upload_call_count += 1;
  let upload;
  try { upload = await callTool(client, "syntx_upload_grok_image_reference", uploadArgs, TOOL_TIMEOUT_MS); }
  catch { return { status: "UPLOAD_OUTCOME_UNKNOWN", failure_stage: "UPLOAD", failure_code: "TRANSPORT_REPLY_LOST", artifacts: [] }; }
  if (upload?.isError === true) {
    const failure = parseToolError(upload);
    return { status: failure.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN" ? "UPLOAD_OUTCOME_UNKNOWN" : "UPLOAD_FAILED",
      failure_stage: "UPLOAD", failure_code: failure.code, artifacts: [] };
  }
  const receipt = upload?.structuredContent;
  const fixtureSha256Hex = fixture.sha256.slice("sha256:".length);
  const handle = safeId(receipt?.reference_handle, HANDLE);
  if (!handle || receipt?.status !== "accepted" || receipt?.profile_id !== descriptor.profile_id || receipt?.model_id !== descriptor.model_id ||
      receipt?.expires_in_seconds !== 900 || receipt?.mime_type !== "image/png" || receipt?.mime_type_source !== "request_declared" ||
      receipt?.size !== fixture.bytes.length || receipt?.size_source !== "request_bytes" || receipt?.image?.mime_type !== "image/png" ||
      receipt?.image?.width !== fixture.width || receipt?.image?.height !== fixture.height || receipt?.image?.byte_length !== fixture.bytes.length ||
      receipt?.image?.sha256 !== fixtureSha256Hex || receipt?.confidence_scope !== "input_bytes_sniffed_and_dimensions_checked") {
    return { status: "UPLOAD_RECEIPT_INVALID", failure_stage: "UPLOAD", failure_code: "UPLOAD_RECEIPT_INVALID", artifacts: [] };
  }

  const parameters = { prompt: descriptor.prompt, resolution: descriptor.resolution, batch_size: descriptor.batch_size };
  const generationHash = sha256(Buffer.from(canonicalJson({ profile_id: descriptor.profile_id, attemptId,
    reference_count: 1, parameters: { prompt_sha256: sha256(Buffer.from(parameters.prompt, "utf8")),
      resolution: descriptor.resolution, batch_size: descriptor.batch_size } }), "utf8"));
  if (!await waitAndEmit(waitAction, "GENERATION_INTENT", { attempt_id: attemptId, intent_fingerprint: actionFingerprint }, ACTION_WINDOW_MS,
    () => emitPrivate(privateSend, "GENERATION_INTENT", { ...safeBase, attempt_id: attemptId,
      intent_fingerprint: actionFingerprint, generation_parameters_sha256: generationHash,
      reference_count: 1, upload_call_count: counts.upload_call_count, generation_call_count: 0, retry_count: 0 }))) {
    return { status: "GENERATION_NOT_APPROVED", artifacts: [] };
  }
  counts.generation_call_count += 1;
  let generated;
  try { generated = await callTool(client, "syntx_owner_generate_grok_reference", {
    profile_id: descriptor.profile_id, link_attempt_id: attemptId, reference_handles: [handle], parameters
  }, GENERATION_TIMEOUT_MS); }
  catch { generated = null; }
  let result = generated;
  let unknownDiagnostic = generated?.isError === true ? parseToolError(generated).diagnostic : null;
  if (generated === null || generated?.isError === true) {
    let recoveryId = generated?.isError === true ? parseToolError(generated).recovery_id : null;
    if (generated === null) {
      const listed = await discoverOneRecovery(client, attemptId, descriptor, counts);
      if (listed.status !== "ONE_MATCH") {
        await emitPrivate(privateSend, "OUTCOME_UNKNOWN_UNRECOVERABLE", { ...safeBase, ...counts,
          recovery_discovery_status: listed.status, retry_count: 0 });
      return { status: "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", failure_stage: "GENERATION", failure_code: "RECOVERY_NOT_UNIQUE", artifacts: [] };
      }
      recoveryId = listed.recovery_id;
      unknownDiagnostic = listed.diagnostic;
    }
    if (generated?.isError === true && parseToolError(generated).code !== "OUTCOME_UNKNOWN") {
      return { status: "GENERATION_FAILED", failure_stage: "GENERATION", failure_code: parseToolError(generated).code, artifacts: [] };
    }
    if (!recoveryId || !RECOVERY.test(recoveryId)) return { status: "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", failure_stage: "GENERATION", failure_code: "RECOVERY_HANDLE_UNAVAILABLE", artifacts: [] };
    const recovery = await reconcileKnown(client, attemptId, recoveryId, descriptor, safeBase, waitAction, privateSend, dependencies, counts, unknownDiagnostic);
    if (recovery.result === null) return { status: "GENERATION_OUTCOME_UNKNOWN", failure_stage: "GENERATION", failure_code: "OUTCOME_UNKNOWN",
      unknown_diagnostic: recovery.diagnostic ?? unknownDiagnostic, artifacts: [] };
    result = recovery.result;
  }
  const observed = await verifyResult(result, descriptor, dependencies, counts);
  if (!observed.ok) return { status: observed.status, failure_stage: "OBSERVATION", failure_code: observed.status,
    actual_result_count: observed.actual_result_count, artifacts: [] };
  return { status: "PASS_FIXED_CASE_RESULT_ONLY", actual_result_count: observed.actual_result_count,
    mime_confidence: "URL_EXTENSION_ONLY", request_fingerprint: observed.request_fingerprint, artifacts: observed.artifacts };
}

async function verifyResult(result, descriptor, dependencies, counts) {
  const value = result?.structuredContent;
  const artifacts = value?.artifacts;
  if (result?.isError === true || value?.status !== "result_observed" || value?.backend_acceptance !== "unproven" ||
      value?.profile_id !== descriptor.profile_id || value?.model_id !== descriptor.model_id || value?.variant_id !== descriptor.profile_id ||
      value?.profile_schema_hash !== descriptor.schema_hash || value?.profile_set_sha256 !== OWNER_GROK_REFERENCE_PROFILE_SET_SHA256 ||
      !/^sha256:[a-f0-9]{64}$/u.test(value?.request_fingerprint ?? "") ||
      value?.requested_batch_size !== descriptor.batch_size || value?.batch_count_matches_requested !== true ||
      value?.mime_confidence !== "URL_EXTENSION_ONLY" || !Array.isArray(artifacts) || artifacts.length !== descriptor.batch_size || artifacts.length > 2) {
    return { ok: false, status: "GENERATION_RESULT_MISMATCH", actual_result_count: Array.isArray(artifacts) ? artifacts.length : null };
  }
  const observe = dependencies.observeOwnedGrokImageArtifact ?? defaultObserveOwnedImageArtifact;
  const safeArtifacts = [];
  for (const artifact of artifacts) {
    if (artifact?.mime_source !== "URL_EXTENSION" || !["image/png", "image/jpeg"].includes(artifact?.mime_type) ||
        typeof artifact?.url !== "string" || typeof artifact?.message_object_id !== "string") {
      return { ok: false, status: "GENERATION_RESULT_MISMATCH", actual_result_count: artifacts.length };
    }
    counts.artifact_observation_count += 1;
    let observation;
    try { observation = await observe({ artifacts: [artifact] }); }
    catch { observation = null; }
    if (observation?.status !== "OBSERVED" || !["image/png", "image/jpeg"].includes(observation.mime) ||
        observation.mime !== artifact.mime_type || observation.declared_mime !== artifact.mime_type ||
        !/^sha256:[a-f0-9]{64}$/u.test(observation.sha256 ?? "") || !Number.isSafeInteger(observation.byte_size) || observation.byte_size <= 0 ||
        !Number.isSafeInteger(observation.width) || observation.width <= 0 || !Number.isSafeInteger(observation.height) || observation.height <= 0) {
      return { ok: false, status: "ARTIFACT_OBSERVATION_MISMATCH", actual_result_count: artifacts.length };
    }
    safeArtifacts.push(Object.freeze({ mime: observation.mime, sha256: observation.sha256,
      byte_size: observation.byte_size, width: observation.width, height: observation.height,
      declared_mime: observation.declared_mime, response_mime_type: observation.response_mime_type ?? null }));
  }
  return { ok: true, actual_result_count: artifacts.length, request_fingerprint: value.request_fingerprint,
    artifacts: Object.freeze(safeArtifacts) };
}

async function discoverOneRecovery(client, attemptId, descriptor, counts) {
  counts.recovery_discovery_call_count += 1;
  let listed;
      try { listed = await callTool(client, "syntx_owner_list_grok_reference_recovery", {
    profile_id: descriptor.profile_id, link_attempt_id: attemptId, limit: 20
  }, TOOL_TIMEOUT_MS); } catch { return { status: "LIST_UNKNOWN" }; }
  const recoveries = listed?.structuredContent?.recoveries;
  if (listed?.isError === true || !Array.isArray(recoveries)) return { status: "LIST_UNAVAILABLE" };
  const matches = recoveries.filter((item) => item?.profile_id === descriptor.profile_id && item?.model_id === descriptor.model_id &&
    item?.requested_batch_size === descriptor.batch_size && typeof item?.created_at === "string" && RECOVERY.test(item?.recovery_id ?? ""));
  if (matches.length !== 1 || recoveries.length !== 1) return { status: matches.length === 0 ? "NONE" : "AMBIGUOUS" };
  return { status: "ONE_MATCH", recovery_id: matches[0].recovery_id,
    diagnostic: parseOwnerGrokReferenceUnknownDiagnostic(matches[0].diagnostic) };
}

async function reconcileKnown(client, attemptId, recoveryId, descriptor, safeBase, waitAction, privateSend, dependencies, counts, initialDiagnostic) {
  const now = dependencies.now ?? Date.now;
  const deadline = now() + ACTION_WINDOW_MS;
  let latestDiagnostic = parseOwnerGrokReferenceUnknownDiagnostic(initialDiagnostic);
  while (now() < deadline) {
    const action = await waitAndEmit(waitAction, "RECOVERY_ACTION", {
      attempt_id: attemptId, recovery_id: recoveryId
    }, Math.max(1, deadline - now()), () => emitPrivate(privateSend, "OUTCOME_UNKNOWN", {
      ...safeBase, attempt_id: attemptId, recovery_id: recoveryId, ...counts, recovery_window: "OPEN", retry_count: 0,
      ...(latestDiagnostic ? { unknown_diagnostic: latestDiagnostic } : {})
    }));
    if (!action || action.action === "finish") return { result: null, finished: true, diagnostic: latestDiagnostic };
    if (action.action !== "reconcile") continue;
    counts.recovery_call_count += 1;
    try {
      const response = await callTool(client, "syntx_owner_reconcile_grok_reference", {
        profile_id: descriptor.profile_id, link_attempt_id: attemptId, recovery_id: recoveryId
      }, TOOL_TIMEOUT_MS);
      if (response?.isError !== true && response?.structuredContent?.status === "result_observed") return { result: response, finished: false };
      if (response?.isError === true) latestDiagnostic = parseToolError(response).diagnostic ?? latestDiagnostic;
    } catch { /* GET-only read can be retried after an explicit fresh owner action. */ }
  }
  return { result: null, finished: true, diagnostic: latestDiagnostic };
}

function schemaMatches(result, descriptor, source) {
  const schema = result?.structuredContent;
  return result?.isError !== true && schema?.profile_id === descriptor.profile_id && schema?.model_id === descriptor.model_id &&
    schema?.variant_id === descriptor.profile_id && schema?.operation_id === "generate-image" && schema?.dispatch_allowed === false &&
    schema?.backend_acceptance === "unproven" && schema?.schema_hash === descriptor.schema_hash &&
    schema?.profile_set_sha256 === source.profile_set_sha256 && schema?.catalog_version === source.catalog_version &&
    schema?.resolution?.required === true && JSON.stringify(schema.resolution.values) === JSON.stringify(["1k", "2k"]) &&
    schema?.batch_size?.required === true && JSON.stringify(schema.batch_size.values) === JSON.stringify([1, 2, 3, 4, 5]) &&
    schema?.reference_count?.minimum === 1 && schema?.reference_count?.maximum === 1 &&
    schema?.aspect_ratio?.required === false && Array.isArray(schema.aspect_ratio.values) && schema.aspect_ratio.values.length === 0;
}

function validationMatches(result, descriptor, source) {
  const value = result?.structuredContent;
  const settings = value?.request?.settings;
  return result?.isError !== true && value?.profile_id === descriptor.profile_id && value?.model_id === descriptor.model_id &&
    value?.schema_hash === descriptor.schema_hash && value?.profile_set_sha256 === source.profile_set_sha256 &&
    value?.catalog_version === source.catalog_version && value?.reference_count === 1 && value?.dispatch_allowed === false &&
    value?.backend_acceptance === "unproven" && value.request.prompt === descriptor.prompt &&
    settings?.model_type === descriptor.model_id && settings?.resolution === descriptor.resolution &&
    settings?.batch_size === descriptor.batch_size && settings?.n === 1 && !Object.hasOwn(settings, "aspect_ratio") &&
    Object.keys(settings).sort().join(",") === "batch_size,model_type,n,resolution";
}

function sourceMatchesPinnedCase(source, descriptor) {
  return source?.version === OWNER_GROK_REFERENCE_PROFILE_VERSION && source.profile_set_sha256 === OWNER_GROK_REFERENCE_PROFILE_SET_SHA256 &&
    source.schema_hashes?.[descriptor.profile_id] === descriptor.schema_hash && typeof source.catalog_version === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(source.source_fingerprint ?? "");
}

function requiredToolSurfaceIsExact(names) {
  const required = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status", ...OWNER_GROK_TOOL_NAMES];
  const grok = names.filter((name) => name.includes("grok_reference") || name.includes("grok_image_reference")).sort();
  const forbidden = ["syntx_upload_image_reference", "syntx_owner_generate_reference_image", "syntx_owner_probe_image_reference",
    "syntx_owner_generate_image", "syntx_generate_image", "syntx_owner_generate_contract_media"];
  return required.every((name) => names.includes(name)) && OWNER_GROK_TOOL_NAMES.slice(0, 6).every((name) => grok.includes(name)) &&
    grok.length === OWNER_GROK_TOOL_NAMES.length && !forbidden.some((name) => names.includes(name));
}

function requiredReadOnlyDiagnosticToolSurfaceIsExact(names) {
  return requiredToolSurfaceIsExact(names) && names.includes("syntx_get_model_access");
}

async function createDefaultOwnerClient(options, sdk) {
  const { Client } = sdk.Client ? sdk : await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = sdk.StdioClientTransport ? sdk : await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "syntx-owner-grok-reference-acceptance", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport(options);
  let closeResolve;
  const exited = new Promise((resolvePromise) => { closeResolve = resolvePromise; });
  const previous = transport.onclose;
  transport.onclose = () => { try { previous?.(); } finally { closeResolve(true); } };
  try { await client.connect(transport); }
  catch { await transport.close().catch(() => undefined); throw new Error("OWNER_STDIO_STARTUP_FAILED"); }
  const initialPid = transport.pid;
  return { client, transport, async waitForExit() {
    if (!Number.isSafeInteger(initialPid) || initialPid <= 0) return false;
    let timer;
    try {
      const closed = await Promise.race([exited, new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), 15_000); timer.unref?.(); })]);
      return closed === true && transport.pid === null;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } };
}

async function defaultObserveOwnedImageArtifact(input) {
  const { observeOwnedImageArtifact } = await import("../dist/src/adapter/syntx/owned-image-artifact-observer.js");
  return observeOwnedImageArtifact(input);
}

async function callToolList(client) { return client.listTools({}, { timeout: TOOL_TIMEOUT_MS }); }
async function callTool(client, name, args, timeout) { return client.callTool({ name, arguments: args }, undefined, { timeout }); }

function waitAndEmit(waitAction, event, context, timeout, emit) {
  const controller = new AbortController();
  let pending;
  try { pending = Promise.resolve(waitAction(event, context, timeout, controller.signal)); }
  catch (error) { controller.abort(); throw error; }
  const observed = pending.catch(() => null);
  return (async () => {
    try { if (!await emit()) throw new Error("PRIVATE_IPC_UNKNOWN"); }
    catch (error) { controller.abort(); void observed; throw error; }
    const action = await observed;
    const expectedAction = { BEGIN: "handoff_sent", UPLOAD_INTENT: "approve_upload",
      GENERATION_INTENT: "approve_generation" }[event];
    const actionMatches = event === "RECOVERY_ACTION"
      ? ["reconcile", "finish"].includes(action?.action)
      : action?.action === expectedAction;
    if (!actionMatches || (context.attempt_id !== undefined && action.attempt_id !== context.attempt_id) ||
        (context.intent_fingerprint !== undefined && action.intent_fingerprint !== context.intent_fingerprint) ||
        (context.recovery_id !== undefined && action.recovery_id !== context.recovery_id)) return null;
    return action;
  })();
}

async function emitPrivate(send, event, fields) {
  return safePrivateSend(send, { event, ...fields });
}

function safePrivateSend(send, message) {
  return Promise.resolve().then(() => send(message, 5_000)).then((value) => value === true, () => false);
}

async function pollLinked(client, attemptId, dependencies) {
  const now = dependencies.now ?? Date.now, sleep = dependencies.sleep ?? delay;
  const deadline = now() + LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    await sleep(LOGIN_POLL_MS);
    const result = await callTool(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    const value = result?.structuredContent;
    if (result?.isError === true || value?.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(value.status)) return false;
  }
  return false;
}

function isActivePaidAccount(result) {
  const value = result?.structuredContent?.subscription;
  return result?.isError !== true && value?.active === true && typeof value.plan_type === "string" &&
    value.plan_type.trim().length > 0 && value.plan_type.trim().toUpperCase() !== "FREE";
}

async function unlinkAndReadBack(client, attemptId) {
  try {
    const unlink = await callTool(client, "syntx_unlink", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    if (unlink?.isError === true || unlink?.structuredContent?.status !== "REVOKED") return "UNCONFIRMED";
    const readback = await callTool(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    return readback?.isError !== true && readback?.structuredContent?.attempt_id === attemptId &&
      readback.structuredContent.status === "REVOKED" && readback.structuredContent.linked === false
      ? "REVOKED_READBACK_CONFIRMED" : "UNCONFIRMED";
  } catch { return "UNCONFIRMED"; }
}

function parseToolError(result) {
  try {
    const value = JSON.parse(result?.content?.find((entry) => entry.type === "text")?.text ?? "{}");
    return { code: typeof value?.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(value.error.code) ? value.error.code : "TOOL_ERROR",
      recovery_id: typeof value?.error?.recovery_id === "string" && RECOVERY.test(value.error.recovery_id) ? value.error.recovery_id : null,
      diagnostic: parseOwnerGrokReferenceUnknownDiagnostic(value?.error?.diagnostic) };
  } catch { return { code: "TOOL_ERROR", recovery_id: null, diagnostic: null }; }
}

function safeFailureCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(code) ? code : null;
}

function safeId(value, pattern) { return typeof value === "string" && pattern.test(value) ? value : null; }
function isSafeHandoffUri(value) {
  try { const uri = new URL(value); return uri.protocol === "https:" && ["t.me", "telegram.me"].includes(uri.hostname) && !uri.username && !uri.password; }
  catch { return false; }
}
function isSourceCheckout() {
  return existsSync(join(PROJECT_ROOT, "AGENTS.md")) && existsSync(join(PROJECT_ROOT, "src")) &&
    existsSync(PROFILE_ARCHIVE) && existsSync(SERVER_PATH);
}
function statusForError(error) {
  const message = error?.message;
  if (message === "REQUIRED_TOOL_SURFACE_INVALID") return "STOCK_GROK_TOOLS_MISSING";
  if (message === "READONLY_DIAGNOSTIC_TOOL_SURFACE_INVALID") return "READONLY_DIAGNOSTIC_TOOLS_MISSING";
  if (message === "PROFILE_SCHEMA_READBACK_MISMATCH") return "PROFILE_SCHEMA_READBACK_MISMATCH";
  if (message === "BEGIN_ACK_MISSING") return "BEGIN_NOT_CONFIRMED";
  if (message === "AUTH_NOT_LINKED") return "AUTH_NOT_LINKED";
  if (message === "SUBSCRIPTION_NOT_VERIFIED") return "SUBSCRIPTION_NOT_VERIFIED";
  return "FAILED";
}
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function summary(status, fields = {}) { const { status: _status, ...safe } = fields; return Object.freeze({ status, ...safe }); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function pngChunk(type, data) { const t = Buffer.from(type, "ascii"); return Buffer.concat([u32(data.length), t, data, u32(pngCrc(Buffer.concat([t, data])))]); }
function pngCrc(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; }
function inspectFixturePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("GROK_FIXTURE_INVALID");
  let offset = 8, width = 0, height = 0; const chunks = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error("GROK_FIXTURE_INVALID");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCrc(Buffer.concat([Buffer.from(type), data])) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("GROK_FIXTURE_INVALID");
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12; if (type === "IEND") break;
  }
  if (offset !== bytes.length || chunks.length === 0) throw new Error("GROK_FIXTURE_INVALID");
  return { width, height, rgbaBytes: inflateSync(Buffer.concat(chunks)).length - height };
}

function isSourceInvocation() { return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }
function defaultSendPrivateIpc(message, timeoutMs) {
  if (typeof process.send !== "function") return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(value); };
    try { process.send(message, (error) => finish(error == null)); } catch { finish(false); }
  });
}
function defaultWaitForPrivateAction(io, event, context, timeoutMs, signal) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); io.off("message", onMessage); signal?.removeEventListener("abort", onAbort); resolvePromise(value); };
    const onMessage = (message) => {
      if (!message || typeof message !== "object") return;
      if (event === "BEGIN" && message.action === "handoff_sent" && message.attempt_id === context.attempt_id &&
          message.intent_fingerprint === context.intent_fingerprint) finish(message);
      else if (["UPLOAD_INTENT", "GENERATION_INTENT"].includes(event) && message.action === (event === "UPLOAD_INTENT" ? "approve_upload" : "approve_generation") && message.intent_fingerprint === context.intent_fingerprint) finish(message);
      else if (event === "RECOVERY_ACTION" && ["reconcile", "finish"].includes(message.action) && message.attempt_id === context.attempt_id && message.recovery_id === context.recovery_id) finish(message);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs); timer.unref?.();
    io.on("message", onMessage); signal?.addEventListener("abort", onAbort, { once: true });
  });
}

if (isSourceInvocation()) {
  const config = parseOwnerGrokReferenceStdioAcceptanceArgs(process.argv.slice(2));
  if (!config) {
    process.stderr.write(`Refusing Grok reference stdio operation. Use an exact fixed-case acceptance flag or the read-only access diagnostic flag.\n`);
    process.exitCode = 2;
  } else {
    const result = await runOwnerGrokReferenceStdioAcceptance(config, process).catch(() => summary("FAILED"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.status.startsWith("PASS")) process.exitCode = 1;
  }
}
