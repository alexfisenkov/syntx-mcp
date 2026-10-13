#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { lstat, link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";

export const OWNER_CLARITY_UPSCALE_CASE_ID = "clarity-emerald-bars-upscale-v3";
export const HISTORICAL_OWNER_CLARITY_UPSCALE_AMBER_CASE_ID = "clarity-amber-checker-upscale-v2";
export const HISTORICAL_OWNER_CLARITY_UPSCALE_CASE_ID = "clarity-cobalt-grid-upscale-v1";
export const OWNER_CLARITY_UPSCALE_PROFILE_ID = "clarity-upscale-source-reviewed-v1";
export const OWNER_CLARITY_UPSCALE_MODEL_ID = "clarity";
export const OWNER_CLARITY_UPSCALE_CASE = Object.freeze({
  case_id: OWNER_CLARITY_UPSCALE_CASE_ID,
  filename: "clarity-emerald-bars-upscale-v3.png",
  prompt: null,
  parameters: Object.freeze({ professional_mode: false, scale_factor: 2, strength: 0.35, cfg: 6, denoise: 0.25 })
});
export const OWNER_CLARITY_UPSCALE_TOOL_NAMES = Object.freeze([
  "syntx_upload_clarity_upscale_image",
  "syntx_owner_generate_clarity_upscale_image",
  "syntx_owner_reconcile_clarity_upscale_image",
  "syntx_owner_list_clarity_upscale_recoveries"
]);

const LIVE_TIMEOUT_MS = 9 * 60_000;
const TOOL_TIMEOUT_MS = 15_000;
const BEGIN_ACK_TIMEOUT_MS = 45_000;
const ACTION_ACK_TIMEOUT_MS = 15 * 60_000;
const GENERATION_TIMEOUT_MS = 200_000;
const RECONCILE_TIMEOUT_MS = 200_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_POLL_MS = 2_500;
const CHILD_CLOSE_TIMEOUT_MS = 15_000;
const ARTIFACT_OBSERVATION_CAP = 8 * 1024 * 1024;
const OWNER_TOOL_NAMES = Object.freeze([
  "syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
  ...OWNER_CLARITY_UPSCALE_TOOL_NAMES
]);
const USAGE = "Usage: node scripts/live-owner-clarity-upscale-smoke.mjs --help | --describe | --dry-run | --read-only\nReal Clarity runs are disabled; old and spent cases cannot be replayed.\n";
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^clarity_image_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^clarity_recovery_[0-9a-f-]{36}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
const CLARITY_DIAGNOSTIC_FIELDS = Object.freeze([
  "phase", "echo_ack_known", "history_get_eligible", "history_get_performed", "history_get_count",
  "history_get_count_capped", "history_binding", "history_binding_reason", "result_get_performed", "result_get_count",
  "result_get_count_capped", "unverified_reason", "upstream_error_code"
]);
const CLARITY_DIAGNOSTIC_PHASES = Object.freeze([
  "POST_CALL_STARTED", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_WAIT", "HISTORY_BINDING",
  "IN_PROGRESS_GET", "RESULT_GET", "RESULT_WAIT", "RESULT_BINDING"
]);
const CLARITY_DIAGNOSTIC_HISTORY_BINDINGS = Object.freeze(["NOT_RUN", "PENDING", "VALID", "INVALID"]);
const CLARITY_DIAGNOSTIC_HISTORY_BINDING_REASONS = Object.freeze([
  "SNAPSHOT_PARSE_FAILED", "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID", "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID",
  "PAGE_INCOMPLETE", "REQUESTED_CHAT_MISMATCH", "PROVIDER_CHAT_ID_INVALID", "TOTAL_COUNT_MISMATCH",
  "TOTAL_PAGES_MISMATCH", "MESSAGE_ID_INVALID", "PROVIDER_CHAT_MISMATCH", "AUTHOR_ROLE_INVALID",
  "OWNER_ECHO_MISSING", "OWNER_ECHO_AMBIGUOUS", "OWNER_ECHO_AUTHOR_MISMATCH", "OWNER_ECHO_OBJECT_INVALID",
  "MESSAGE_CARDINALITY_INVALID", "BOT_CANDIDATE_CARDINALITY_INVALID", "BOT_OBJECT_INVALID"
]);
const CLARITY_DIAGNOSTIC_UNVERIFIED_REASONS = Object.freeze([
  "OUTER_MESSAGE_MISMATCH", "NOT_BOT_MESSAGE", "NO_IMAGE_OBJECTS", "RESULT_COUNT_OUT_OF_RANGE",
  "RESULT_OBJECT_INCOMPLETE", "RESULT_OBJECT_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
]);
const CLARITY_DIAGNOSTIC_UPSTREAM_CODES = Object.freeze([
  "INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
]);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const OWNER_OPERATOR_JOURNAL_DIRECTORY = join(PROJECT_ROOT, ".autopilot", "owner-clarity-operator");
const configs = new WeakSet();
const internalFixtureConfigs = new WeakSet();
const OWNER_ENV = Object.freeze({ SYNTX_OWNER_CLARITY_UPSCALE: "1", SYNTX_OWNER_ACCOUNT_STATUS: "1" });
const READ_ONLY_ENV = Object.freeze({ SYNTX_OWNER_CLARITY_UPSCALE: "1", SYNTX_OWNER_ACCOUNT_STATUS: "0" });
const DEFAULT_OFF_ENV = Object.freeze({ SYNTX_OWNER_CLARITY_UPSCALE: "0", SYNTX_OWNER_ACCOUNT_STATUS: "0" });

/** Closed CLI grammar. Real Clarity runs stay disabled after the spent Emerald case. */
export function parseOwnerClarityUpscaleSmokeArgs(argv) {
  if (!Array.isArray(argv)) return null;
  let mode;
  if (argv.length === 1 && argv[0] === "--help") mode = "HELP";
  else if (argv.length === 1 && argv[0] === "--describe") mode = "DESCRIBE";
  else if (argv.length === 1 && argv[0] === "--dry-run") mode = "DRY_RUN";
  else if (argv.length === 1 && argv[0] === "--read-only") mode = "READ_ONLY";
  else return null;
  const config = Object.freeze({ mode, case_id: OWNER_CLARITY_UPSCALE_CASE_ID });
  configs.add(config);
  return config;
}

/** Test-only flow token: usable only with an injected fixture/client/IPC dependency set and non-process IO. */
export function createOwnerClarityUpscaleInternalFixtureConfig() {
  const config = Object.freeze({ mode: "INTERNAL_FIXTURE_FLOW", case_id: OWNER_CLARITY_UPSCALE_CASE_ID });
  configs.add(config);
  internalFixtureConfigs.add(config);
  return config;
}

/** Historical Cobalt fixture from the ended case; retained for history, never selected by current flows. */
export function createOwnerClarityUpscaleFixture() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const inTile = x >= 64 && x < 448 && y >= 64 && y < 448;
      let color = inTile ? [34, 78, 177, 255] : [226, 226, 218, 255];
      if (inTile && (x - 64) % 64 < 4) color = [111, 158, 231, 255];
      if (inTile && (y - 64) % 64 < 4) color = [111, 158, 231, 255];
      const dx = x - 256;
      const dy = y - 256;
      if (dx * dx + dy * dy < 48 * 48) color = [27, 48, 112, 255];
      if (Math.abs(dx) <= 3 || Math.abs(dy) <= 3) color = inTile ? [191, 204, 236, 255] : color;
      const rawOffset = rowOffset + 1 + x * 4;
      raw[rawOffset] = color[0]; raw[rawOffset + 1] = color[1]; raw[rawOffset + 2] = color[2]; raw[rawOffset + 3] = color[3];
      const pixelOffset = (y * width + x) * 4;
      rgba[pixelOffset] = color[0]; rgba[pixelOffset + 1] = color[1]; rgba[pixelOffset + 2] = color[2]; rgba[pixelOffset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== rgba.length || bytes.length >= 7 * 1024 * 1024) {
    throw new Error("CLARITY_FIXTURE_INVALID");
  }
  return Object.freeze({
    bytes, filename: "clarity-cobalt-grid-upscale-v1.png", mime_type: "image/png",
    width, height, sha256: sha256(bytes), pixel_sha256: sha256(rgba), runtime_node_version: process.versions.node
  });
}

/** Canonical metadata and action fingerprint shared with BEGIN/READ/UPLOAD/GEN acknowledgments. */
export function buildOwnerClarityUpscaleSafeIntentMetadata({ fixture, source, harnessSha256 }) {
  if (!validFixedFixture(fixture) || !validSource(source) || !/^sha256:[a-f0-9]{64}$/u.test(harnessSha256 ?? "")) {
    throw new Error("SAFE_INTENT_METADATA_INVALID");
  }
  const parameters = Object.freeze({ ...OWNER_CLARITY_UPSCALE_CASE.parameters });
  const expectedWidth = fixture.width * parameters.scale_factor;
  const expectedHeight = fixture.height * parameters.scale_factor;
  if (!Number.isSafeInteger(expectedWidth) || expectedWidth < 1 || !Number.isSafeInteger(expectedHeight) || expectedHeight < 1) {
    throw new Error("SAFE_INTENT_METADATA_INVALID");
  }
  const safeBase = Object.freeze({
    case_id: OWNER_CLARITY_UPSCALE_CASE_ID,
    profile_id: OWNER_CLARITY_UPSCALE_PROFILE_ID,
    model_id: OWNER_CLARITY_UPSCALE_MODEL_ID,
    operation_id: "upscale-image",
    profile_schema_hash: source.profile_schema_hash,
    public_catalog_version: source.public_catalog_version,
    catalog_version: source.catalog_version,
    public_models_sha256: source.public_models_sha256,
    source_fingerprint: source.source_fingerprint,
    fixture_filename: fixture.filename,
    fixture_mime_type: fixture.mime_type,
    fixture_width: fixture.width,
    fixture_height: fixture.height,
    fixture_byte_size: fixture.bytes.length,
    fixture_sha256: fixture.sha256,
    fixture_pixel_sha256: fixture.pixel_sha256,
    runtime_node_version: fixture.runtime_node_version,
    harness_sha256: harnessSha256,
    prompt_included: false,
    parameters,
    expected_output_geometry: Object.freeze({ width: expectedWidth, height: expectedHeight })
  });
  const actionFingerprint = sha256(Buffer.from(canonicalJson(safeBase), "utf8"));
  return Object.freeze({ safeBase, actionFingerprint });
}

/** Historical Amber input retained verbatim for its ended case; never selected by the active flow. */
export function createOwnerClarityUpscaleAmberFixture() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const checker = ((Math.floor(x / 32) + Math.floor(y / 32)) & 1) === 0;
      let color = checker ? [244, 169, 54, 255] : [71, 52, 37, 255];
      if (x < 32 || x >= 480 || y < 32 || y >= 480) color = [35, 59, 69, 255];
      if ((x % 64 < 3 || y % 64 < 3) && x >= 32 && x < 480 && y >= 32 && y < 480) color = [255, 218, 136, 255];
      const dx = x - 256;
      const dy = y - 256;
      if (Math.abs(dx) + Math.abs(dy) < 84) color = [128, 71, 31, 255];
      if (Math.abs(dx) <= 2 || Math.abs(dy) <= 2) color = [255, 236, 187, 255];
      const rawOffset = rowOffset + 1 + x * 4;
      raw[rawOffset] = color[0]; raw[rawOffset + 1] = color[1]; raw[rawOffset + 2] = color[2]; raw[rawOffset + 3] = color[3];
      const pixelOffset = (y * width + x) * 4;
      rgba[pixelOffset] = color[0]; rgba[pixelOffset + 1] = color[1]; rgba[pixelOffset + 2] = color[2]; rgba[pixelOffset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== rgba.length || bytes.length >= 25 * 1024 * 1024) {
    throw new Error("CLARITY_FIXTURE_INVALID");
  }
  return Object.freeze({
    bytes, filename: "clarity-amber-checker-upscale-v2.png", mime_type: "image/png",
    width, height, sha256: sha256(bytes), pixel_sha256: sha256(rgba), runtime_node_version: process.versions.node
  });
}

/** Fresh pixel-distinct Emerald horizontal-bar input for the new source-reviewed case. */
export function createOwnerClarityUpscaleEmeraldFixture() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 40 && x < 472 && y >= 40 && y < 472;
      let color = inside ? [27, 57, 47, 255] : [16, 31, 37, 255];
      for (let bar = 0; bar < 8; bar += 1) {
        const top = 64 + bar * 50;
        const inset = (bar % 3) * 12;
        const left = 56 + inset;
        const right = 456 - inset;
        if (x >= left && x < right && y >= top && y < top + 26) {
          color = y < top + 3 ? [164, 229, 178, 255] : [18, 132, 84, 255];
        }
        if (x >= left && x < right && y >= top + 22 && y < top + 26) color = [31, 91, 65, 255];
      }
      if ((x % 64 < 2 || y % 64 < 2) && inside) color = [55, 83, 71, 255];
      const rawOffset = rowOffset + 1 + x * 4;
      raw[rawOffset] = color[0]; raw[rawOffset + 1] = color[1]; raw[rawOffset + 2] = color[2]; raw[rawOffset + 3] = color[3];
      const pixelOffset = (y * width + x) * 4;
      rgba[pixelOffset] = color[0]; rgba[pixelOffset + 1] = color[1]; rgba[pixelOffset + 2] = color[2]; rgba[pixelOffset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== rgba.length ||
      decoded.pixel_sha256 !== sha256(rgba) || bytes.length >= 25 * 1024 * 1024) throw new Error("CLARITY_FIXTURE_INVALID");
  return Object.freeze({ bytes, filename: OWNER_CLARITY_UPSCALE_CASE.filename, mime_type: "image/png",
    width, height, sha256: sha256(bytes), pixel_sha256: sha256(rgba), runtime_node_version: process.versions.node });
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([u32(data.length), typeBytes, data, u32(pngCrc(Buffer.concat([typeBytes, data])))]);
}

function pngCrc(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value);
  return output;
}

function inspectFixturePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("CLARITY_FIXTURE_INVALID");
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error("CLARITY_FIXTURE_INVALID");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCrc(Buffer.concat([Buffer.from(type, "ascii"), data])) !== bytes.readUInt32BE(offset + 8 + length)) {
      throw new Error("CLARITY_FIXTURE_INVALID");
    }
    if (type === "IHDR") {
      if (length !== 13 || width !== 0 || height !== 0) throw new Error("CLARITY_FIXTURE_INVALID");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") {
      if (length !== 0) throw new Error("CLARITY_FIXTURE_INVALID");
      ended = true;
      offset += length + 12;
      break;
    }
    offset += length + 12;
  }
  if (!ended || offset !== bytes.length || width < 1 || height < 1 || compressed.length === 0) throw new Error("CLARITY_FIXTURE_INVALID");
  const decoded = inflateSync(Buffer.concat(compressed));
  if (decoded.length !== (width * 4 + 1) * height) throw new Error("CLARITY_FIXTURE_INVALID");
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const decodedOffset = y * (width * 4 + 1);
    if (decoded[decodedOffset] !== 0) throw new Error("CLARITY_FIXTURE_INVALID");
    decoded.copy(rgba, y * width * 4, decodedOffset + 1, decodedOffset + 1 + width * 4);
  }
  return Object.freeze({ width, height, rgbaBytes: rgba.length, pixel_sha256: sha256(rgba) });
}

function validFixedFixture(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Buffer.isBuffer(value.bytes) ||
      value.filename !== OWNER_CLARITY_UPSCALE_CASE.filename || value.mime_type !== "image/png" ||
      value.width !== 512 || value.height !== 512 || value.runtime_node_version !== process.versions.node ||
      !/^sha256:[a-f0-9]{64}$/u.test(value.sha256 ?? "") || !/^sha256:[a-f0-9]{64}$/u.test(value.pixel_sha256 ?? "")) return false;
  try {
    const decoded = inspectFixturePng(value.bytes);
    return value.bytes.length < 25 * 1024 * 1024 && sha256(value.bytes) === value.sha256 &&
      decoded.width === value.width && decoded.height === value.height && decoded.rgbaBytes === value.width * value.height * 4 &&
      decoded.pixel_sha256 === value.pixel_sha256;
  } catch { return false; }
}

function validSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const expected = ["profile_id", "model_id", "profile_schema_hash", "public_catalog_version", "catalog_version",
    "public_models_sha256", "source_binding", "source_fingerprint"];
  return keys.length === expected.length && keys.every((key) => typeof key === "string" && expected.includes(key) &&
      "value" in descriptors[key] && descriptors[key].enumerable) &&
    value.profile_id === OWNER_CLARITY_UPSCALE_PROFILE_ID && value.model_id === OWNER_CLARITY_UPSCALE_MODEL_ID &&
    /^sha256:[a-f0-9]{64}$/u.test(value.profile_schema_hash ?? "") &&
    value.public_catalog_version === "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" &&
    /^.+\.36e6960df354$/u.test(value.catalog_version ?? "") &&
    value.public_models_sha256 === "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" &&
    value.source_binding?.public_catalog_version === value.public_catalog_version &&
    value.source_binding?.public_models_sha256 === value.public_models_sha256 &&
    /^sha256:[a-f0-9]{64}$/u.test(value.source_fingerprint ?? "");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function mutationCallZeros() {
  return Object.freeze({ upload: 0, generation: 0, reconcile: 0, recovery_list: 0, retry: 0 });
}

function summary(status, fields = {}) {
  return Object.freeze({ status, ...fields });
}

function snapshotClarityDiagnostic(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== CLARITY_DIAGNOSTIC_FIELDS.length ||
        keys.some((key) => typeof key !== "string" || !CLARITY_DIAGNOSTIC_FIELDS.includes(key) ||
          !("value" in descriptors[key]) || !descriptors[key].enumerable)) return null;
    const fields = Object.create(null);
    for (const key of CLARITY_DIAGNOSTIC_FIELDS) fields[key] = descriptors[key].value;
    const validCount = (count) => Number.isSafeInteger(count) && count >= 0 && count <= 255;
    const historyReasonInScope = fields.history_binding === "INVALID"
      ? fields.phase === "HISTORY_BINDING" && CLARITY_DIAGNOSTIC_HISTORY_BINDING_REASONS.includes(fields.history_binding_reason)
      : fields.history_binding_reason === null;
    if (!CLARITY_DIAGNOSTIC_PHASES.includes(fields.phase) ||
        !CLARITY_DIAGNOSTIC_HISTORY_BINDINGS.includes(fields.history_binding) ||
        !historyReasonInScope ||
        !(fields.unverified_reason === null || CLARITY_DIAGNOSTIC_UNVERIFIED_REASONS.includes(fields.unverified_reason)) ||
        !(fields.upstream_error_code === null || CLARITY_DIAGNOSTIC_UPSTREAM_CODES.includes(fields.upstream_error_code)) ||
        typeof fields.echo_ack_known !== "boolean" || typeof fields.history_get_eligible !== "boolean" ||
        typeof fields.history_get_performed !== "boolean" || !validCount(fields.history_get_count) ||
        typeof fields.history_get_count_capped !== "boolean" || typeof fields.result_get_performed !== "boolean" ||
        !validCount(fields.result_get_count) || typeof fields.result_get_count_capped !== "boolean") return null;
    return Object.freeze(Object.fromEntries(CLARITY_DIAGNOSTIC_FIELDS.map((key) => [key, fields[key]])));
  } catch { return null; }
}

const OWNER_OPERATOR_JOURNAL_INPUT_FIELDS = Object.freeze([
  "case_id", "source_fingerprint", "profile_schema_hash", "fixture_sha256", "fixture_pixel_sha256",
  "harness_sha256", "runtime_node_version", "action_fingerprint", "stage", "outcome",
  "upload_call_count", "generation_call_count", "recovery_discovery_call_count", "recovery_call_count",
  "artifact_observation_count", "retry_count", "generation_diagnostic", "local_unlink_status",
  "client_close_status", "child_close_status"
]);
const OWNER_OPERATOR_JOURNAL_STAGES = Object.freeze(["GENERATION_DISPATCH_POSSIBLE", "FINAL_OUTCOME"]);
const OWNER_OPERATOR_JOURNAL_OUTCOMES = Object.freeze([
  "DISPATCH_POSSIBLE", "PRE_GENERATION_FAILED", "OUTCOME_UNKNOWN", "GENERATION_FAILED",
  "GENERATION_RESULT_INVALID", "RESULT_BYTES_UNVERIFIED", "ARTIFACT_GEOMETRY_MISMATCH",
  "RESULT_OBSERVED_CLEANUP_CONFIRMED", "RESULT_OBSERVED_CLEANUP_UNCONFIRMED"
]);
const OWNER_OPERATOR_JOURNAL_UNLINK_STATES = Object.freeze(["NOT_ATTEMPTED", "REVOKED_READBACK_CONFIRMED", "UNCONFIRMED"]);
const OWNER_OPERATOR_JOURNAL_CLOSE_STATES = Object.freeze(["NOT_ATTEMPTED", "CLOSED", "UNCONFIRMED"]);

function createOwnerClarityOperatorJournal() {
  return createOwnerClarityOperatorJournalAt(OWNER_OPERATOR_JOURNAL_DIRECTORY);
}

/** Test seam restricted to OS temp directories; no CLI flag or production path override exists. */
export function createOwnerClarityOperatorJournalForTests(directory) {
  const tempRoot = resolve(tmpdir());
  const target = resolve(directory);
  if (target === tempRoot || !target.startsWith(`${tempRoot}${sep}`)) throw new Error("TEST_JOURNAL_DIRECTORY_INVALID");
  return createOwnerClarityOperatorJournalAt(target);
}

function createOwnerClarityOperatorJournalAt(directory) {
  return Object.freeze({ async append(input) {
    const safeInput = snapshotOwnerClarityOperatorJournalInput(input);
    let temporaryPath;
    let file;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryStat = await lstat(directory);
      const ownerUid = process.getuid?.();
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
          (ownerUid !== undefined && directoryStat.uid !== ownerUid) || (directoryStat.mode & 0o777) !== 0o700) {
        throw new Error("PRIVATE_DIRECTORY_INVALID");
      }
      const record = Object.freeze({ schema_version: 1, recorded_at_utc: new Date().toISOString(), ...safeInput });
      const text = `${canonicalJson(record)}\n`;
      const recordId = randomUUID();
      const filename = `${Date.now()}-${recordId}.json`;
      temporaryPath = join(directory, `.pending-${recordId}.tmp`);
      const finalPath = join(directory, filename);
      file = await open(temporaryPath, "wx", 0o600);
      const fileStat = await file.stat();
      if (!fileStat.isFile() || (ownerUid !== undefined && fileStat.uid !== ownerUid) ||
          (fileStat.mode & 0o777) !== 0o600) throw new Error("PRIVATE_FILE_INVALID");
      await file.writeFile(text, { encoding: "utf8" });
      await file.sync();
      await file.close();
      file = undefined;
      await link(temporaryPath, finalPath);
      await unlink(temporaryPath);
      temporaryPath = undefined;
      const directoryHandle = await open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      return true;
    } catch {
      if (file) await file.close().catch(() => undefined);
      if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
      throw new Error("OPERATOR_JOURNAL_WRITE_FAILED");
    }
  } });
}

function snapshotOwnerClarityOperatorJournalInput(input) {
  const fields = readExactSafeDataRecord(input, OWNER_OPERATOR_JOURNAL_INPUT_FIELDS);
  const validHash = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 255;
  const diagnostic = fields?.generation_diagnostic === null ? null : snapshotClarityDiagnostic(fields?.generation_diagnostic);
  if (!fields || fields.case_id !== OWNER_CLARITY_UPSCALE_CASE_ID || !validHash(fields.source_fingerprint) ||
      !validHash(fields.profile_schema_hash) || !validHash(fields.fixture_sha256) || !validHash(fields.fixture_pixel_sha256) ||
      !validHash(fields.harness_sha256) || !validHash(fields.action_fingerprint) ||
      typeof fields.runtime_node_version !== "string" || !/^\d+\.\d+\.\d+$/u.test(fields.runtime_node_version) ||
      !OWNER_OPERATOR_JOURNAL_STAGES.includes(fields.stage) || !OWNER_OPERATOR_JOURNAL_OUTCOMES.includes(fields.outcome) ||
      (fields.stage === "GENERATION_DISPATCH_POSSIBLE" && fields.outcome !== "DISPATCH_POSSIBLE") ||
      (fields.stage === "FINAL_OUTCOME" && fields.outcome === "DISPATCH_POSSIBLE") ||
      !validCount(fields.upload_call_count) || !validCount(fields.generation_call_count) ||
      !validCount(fields.recovery_discovery_call_count) || !validCount(fields.recovery_call_count) ||
      !validCount(fields.artifact_observation_count) || !validCount(fields.retry_count) ||
      (fields.generation_diagnostic !== null && diagnostic === null) ||
      !OWNER_OPERATOR_JOURNAL_UNLINK_STATES.includes(fields.local_unlink_status) ||
      !OWNER_OPERATOR_JOURNAL_CLOSE_STATES.includes(fields.client_close_status) ||
      !OWNER_OPERATOR_JOURNAL_CLOSE_STATES.includes(fields.child_close_status)) throw new Error("OPERATOR_JOURNAL_RECORD_INVALID");
  return Object.freeze(Object.fromEntries(OWNER_OPERATOR_JOURNAL_INPUT_FIELDS.map((key) => [
    key, key === "generation_diagnostic" ? diagnostic : fields[key]
  ])));
}

function readOwnDataField(value, key) {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function readExactSafeDataRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length ||
        ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
          !("value" in descriptors[key]) || !descriptors[key].enumerable)) return null;
    const output = Object.create(null);
    for (const key of keys) output[key] = descriptors[key].value;
    return output;
  } catch { return null; }
}

function isSourceCheckout() {
  return existsSync(join(PROJECT_ROOT, "AGENTS.md")) && existsSync(join(PROJECT_ROOT, "src")) && existsSync(SERVER_PATH);
}

async function createDefaultOwnerClient(options, sdk = {}) {
  const { Client } = sdk.Client ? sdk : await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = sdk.StdioClientTransport ? sdk : await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "syntx-owner-clarity-upscale-smoke", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport(options);
  let resolveClosed;
  const exited = new Promise((resolvePromise) => { resolveClosed = resolvePromise; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { try { previousOnClose?.(); } finally { resolveClosed(true); } };
  try { await client.connect(transport); }
  catch {
    await transport.close().catch(() => undefined);
    throw new Error("OWNER_STDIO_STARTUP_FAILED");
  }
  const initialPid = transport.pid;
  return Object.freeze({ client, async waitForExit() {
    if (!Number.isSafeInteger(initialPid) || initialPid <= 0) return false;
    let timer;
    try {
      const closed = await Promise.race([exited, new Promise((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(false), CHILD_CLOSE_TIMEOUT_MS);
        timer.unref?.();
      })]);
      return closed === true && transport.pid === null;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } });
}

async function callToolList(client) {
  return client.listTools({}, { timeout: TOOL_TIMEOUT_MS, maxTotalTimeout: TOOL_TIMEOUT_MS });
}

async function callTool(client, name, arguments_, timeout = TOOL_TIMEOUT_MS) {
  return client.callTool({ name, arguments: arguments_ }, undefined, { timeout, maxTotalTimeout: timeout });
}

function isSourceInvocation() {
  return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isSourceInvocation()) {
  const config = parseOwnerClarityUpscaleSmokeArgs(process.argv.slice(2));
  if (config === null) {
    process.stderr.write(`Refusing Clarity owner operation. Real runs are disabled; use --help for non-mutating commands.\n`);
    process.exitCode = 2;
  } else if (config.mode === "HELP") {
    process.stdout.write(`${USAGE}`);
  } else {
    const result = await runOwnerClarityUpscaleSmoke(config, process).catch(() => summary("FAILED"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!["DESCRIPTION", "DRY_RUN_READY", "READ_ONLY_SURFACE_PASS", "PASS_FIXED_CASE_RESULT_ONLY"].includes(result.status)) process.exitCode = 1;
  }
}

export async function loadOwnerClarityUpscaleSource() {
  const [{ getOwnerClarityUpscaleSourceProfile }, { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION },
    { schemaHash }] = await Promise.all([
    import("../dist/src/application/owner-clarity-upscale-request-preparer.js"),
    import("../dist/src/catalog/selected-discovery-catalog.js"),
    import("../dist/src/domain/generation-contract.js")
  ]);
  const profile = getOwnerClarityUpscaleSourceProfile();
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
  const model = catalog.getModel("clarity");
  if (profile.profile_id !== OWNER_CLARITY_UPSCALE_PROFILE_ID || profile.model_id !== OWNER_CLARITY_UPSCALE_MODEL_ID ||
      profile.source_binding.public_catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
      profile.source_binding.public_models_sha256 !== catalog.source_hashes.models ||
      catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || catalog.runtime_usable !== false ||
      model.id !== "clarity" || model.ai_name !== "clarity" || model.upstream_id !== "clarity" ||
      model.scope !== "tool_image_upscaler" || model.active !== true ||
      !model.operations.some((operation) => operation.id === "upscale-image" && operation.output_modality === "image")) {
    throw new Error("CLARITY_SOURCE_BINDING_MISMATCH");
  }
  const profileSchemaHash = schemaHash(profile);
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const sourceFingerprint = sha256(Buffer.from(canonicalJson({
    profile_id: profile.profile_id, profile_schema_hash: profileSchemaHash,
    public_catalog_version: profile.source_binding.public_catalog_version,
    catalog_version: catalogVersion, public_models_sha256: catalog.source_hashes.models,
    source_binding: profile.source_binding
  }), "utf8"));
  return Object.freeze({ profile_id: profile.profile_id, model_id: profile.model_id,
    profile_schema_hash: profileSchemaHash, public_catalog_version: profile.source_binding.public_catalog_version,
    catalog_version: catalogVersion, public_models_sha256: catalog.source_hashes.models,
    source_binding: profile.source_binding, source_fingerprint: sourceFingerprint });
}

export async function runOwnerClarityUpscaleSmoke(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !configs.has(config)) return summary("CONFIRMATION_REQUIRED");
  if (internalFixtureConfigs.has(config)) {
    const injectedFixtureFlow = ["createFixture", "loadClarityUpscaleSource", "createOwnerClient", "sendPrivateIpc",
      "waitForPrivateAction", "observeOwnedImageArtifact", "now", "sleep"]
      .every((key) => typeof dependencies[key] === "function") && typeof dependencies.harnessSha256 === "string" &&
      typeof dependencies.operatorJournal?.append === "function";
    if (io === process || !injectedFixtureFlow) return summary("TEST_FIXTURE_DEPENDENCIES_REQUIRED");
    return runLiveClaritySmoke(config, io, dependencies);
  }
  if (config.mode === "HELP") return summary("HELP", { usage: USAGE.trim() });
  if (config.mode === "DESCRIBE") return summary("DESCRIPTION", {
    case_id: OWNER_CLARITY_UPSCALE_CASE_ID,
    profile_id: OWNER_CLARITY_UPSCALE_PROFILE_ID,
    model_id: OWNER_CLARITY_UPSCALE_MODEL_ID,
    requested_settings: OWNER_CLARITY_UPSCALE_CASE.parameters,
    prompt_included: false,
    mutation_calls: mutationCallZeros()
  });
  if (config.mode === "DRY_RUN") {
    const fixture = (dependencies.createFixture ?? createOwnerClarityUpscaleEmeraldFixture)();
    try {
      const source = await (dependencies.loadClarityUpscaleSource ?? loadOwnerClarityUpscaleSource)();
      const harnessSha256 = dependencies.harnessSha256 ?? sha256(readFileSync(fileURLToPath(import.meta.url)));
      const metadata = buildOwnerClarityUpscaleSafeIntentMetadata({ fixture, source, harnessSha256 });
      return summary("DRY_RUN_READY", { ...metadata.safeBase, action_fingerprint: metadata.actionFingerprint,
        mutation_calls: mutationCallZeros(), auth_calls: 0, private_ipc_calls: 0, child_started: false });
    } catch {
      return summary("DRY_RUN_SOURCE_UNAVAILABLE", { case_id: OWNER_CLARITY_UPSCALE_CASE_ID,
        mutation_calls: mutationCallZeros(), auth_calls: 0, private_ipc_calls: 0, child_started: false });
    }
  }
  if (config.mode === "READ_ONLY") return runReadOnly(config, dependencies);
  return summary("CONFIRMATION_REQUIRED");
}

async function runReadOnly(config, dependencies) {
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) return summary("SOURCE_CHECKOUT_REQUIRED", { case_id: config.case_id });
  const createOwnerClient = dependencies.createOwnerClient ?? createDefaultOwnerClient;
  const surfaces = [];
  const cleanup = [];
  const sessions = [];
  let status;
  try {
    for (const [label, env] of [["default_off", DEFAULT_OFF_ENV], ["opted_in", READ_ONLY_ENV]]) {
      const session = await createOwnerClient({ command: process.execPath, args: [SERVER_PATH], cwd: PROJECT_ROOT, env, stderr: "pipe" }, dependencies.sdk ?? {});
      sessions.push(session);
      const listed = await callToolList(session.client);
      const names = [...new Set((listed?.tools ?? []).map((tool) => tool?.name).filter((name) => typeof name === "string"))].sort();
      const clarityNames = names.filter((name) => OWNER_CLARITY_UPSCALE_TOOL_NAMES.includes(name));
      if (listed?.isError === true || (label === "default_off" && clarityNames.length !== 0) ||
          (label === "opted_in" && !OWNER_CLARITY_UPSCALE_TOOL_NAMES.every((name) => names.includes(name)))) {
        surfaces.push(Object.freeze({ mode: label, status: "TOOL_SURFACE_INVALID", clarity_tool_count: clarityNames.length }));
        break;
      }
      surfaces.push(Object.freeze({ mode: label, status: "PASS", clarity_tool_count: clarityNames.length,
        account_status_tool_present: names.includes("syntx_get_account_status") }));
    }
  } catch {
    surfaces.push(Object.freeze({ mode: "startup", status: "OWNER_STDIO_STARTUP_FAILED", clarity_tool_count: 0 }));
  } finally {
    for (const session of sessions.reverse()) {
      let clientClosed = false;
      let childClosed = false;
      try { await session.client.close(); clientClosed = true; } catch { /* closed status remains false */ }
      try { childClosed = await session.waitForExit() === true; } catch { /* no private process data returned */ }
      cleanup.push(Object.freeze({ client_closed: clientClosed, child_closed: childClosed }));
    }
  }
  status = surfaces.length === 2 && surfaces.every((surface) => surface.status === "PASS") &&
    cleanup.length === 2 && cleanup.every((entry) => entry.client_closed && entry.child_closed)
    ? "READ_ONLY_SURFACE_PASS" : "READ_ONLY_SURFACE_FAILED";
  return summary(status, { case_id: OWNER_CLARITY_UPSCALE_CASE_ID, surfaces: Object.freeze(surfaces),
    cleanup: Object.freeze(cleanup.reverse()), mutation_calls: mutationCallZeros(), auth_calls: 0, private_ipc_calls: 0 });
}

async function runLiveClaritySmoke(config, io, dependencies) {
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) return summary("SOURCE_CHECKOUT_REQUIRED", { case_id: config.case_id });
  const rawPrivateSend = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const rawWaitAction = dependencies.waitForPrivateAction ?? (io === process
    ? (event, context, timeout, signal) => defaultWaitForPrivateAction(io, event, context, timeout, signal) : null);
  if (typeof rawPrivateSend !== "function" || typeof rawWaitAction !== "function") return summary("PRIVATE_IPC_REQUIRED", { case_id: config.case_id });

  let fixture;
  let source;
  let metadata;
  try {
    fixture = (dependencies.createFixture ?? createOwnerClarityUpscaleEmeraldFixture)();
    source = await (dependencies.loadClarityUpscaleSource ?? loadOwnerClarityUpscaleSource)();
    const harnessSha256 = dependencies.harnessSha256 ?? sha256(readFileSync(fileURLToPath(import.meta.url)));
    metadata = buildOwnerClarityUpscaleSafeIntentMetadata({ fixture, source, harnessSha256 });
  } catch {
    return summary("SOURCE_PROFILE_OR_FIXTURE_INVALID", { case_id: config.case_id, mutation_calls: mutationCallZeros() });
  }

  const operatorJournal = dependencies.operatorJournal ?? createOwnerClarityOperatorJournal();
  const counts = { account_status_call_count: 0, upload_call_count: 0, generation_call_count: 0,
    recovery_discovery_call_count: 0, recovery_call_count: 0, artifact_observation_count: 0, retry_count: 0 };
  let session;
  let attemptId = null;
  let beginAcknowledged = false;
  let accountReadStatus = "NOT_ATTEMPTED";
  let localUnlink = "NOT_ATTEMPTED";
  let clientClose = "NOT_ATTEMPTED";
  let childClose = "NOT_ATTEMPTED";
  let status = "FAILED";
  let failureStage = null;
  let failureCode = null;
  let beginIntentFingerprint = null;
  let readIntentFingerprint = null;
  let uploadIntentFingerprint = null;
  let generationIntentFingerprint = null;
  let uploadReceipt = null;
  let generationResult = null;
  let observedArtifact = null;
  let artifactUrl = null;
  let imageHandle = null;
  let recoveryId = null;
  let generationDiagnostic = null;
  let uploadStarted = false;
  let generationStarted = false;
  let generationStartedAt = null;
  let journalFailedBeforeGeneration = false;
  let parentDisconnected = false;
  let resolveParentDisconnected;
  const parentDisconnectController = new AbortController();
  const parentDisconnectedPromise = new Promise((resolvePromise) => { resolveParentDisconnected = resolvePromise; });
  const observeDisconnect = typeof io?.on === "function" && typeof io?.off === "function";
  const onParentDisconnect = () => {
    if (parentDisconnected) return;
    parentDisconnected = true;
    parentDisconnectController.abort();
    resolveParentDisconnected();
  };
  if (io?.connected === false) onParentDisconnect();
  else if (observeDisconnect) io.on("disconnect", onParentDisconnect);
  const parentDisconnectedFailure = () => safeFailure(
    generationStarted ? "GENERATION_OUTCOME_UNKNOWN" : "OPERATOR_PARENT_DISCONNECTED", "OPERATOR_PARENT_DISCONNECTED");
  const whileParentConnected = (pending) => observeDisconnect
    ? Promise.race([Promise.resolve(pending), parentDisconnectedPromise.then(() => { throw parentDisconnectedFailure(); })])
    : Promise.resolve(pending);
  const privateSend = async (message, timeoutMs) => {
    if (parentDisconnected) return false;
    try { return await whileParentConnected(rawPrivateSend(message, timeoutMs)); } catch { return false; }
  };
  const waitAction = (event, context, timeoutMs, signal) => {
    if (parentDisconnected) return Promise.resolve(null);
    const combined = new AbortController();
    const abortWait = () => { if (!combined.signal.aborted) combined.abort(); };
    const onLocalAbort = () => abortWait();
    signal?.addEventListener("abort", onLocalAbort, { once: true });
    parentDisconnectController.signal.addEventListener("abort", abortWait, { once: true });
    if (signal?.aborted || parentDisconnectController.signal.aborted) abortWait();
    let pending;
    try { pending = rawWaitAction(event, context, timeoutMs, combined.signal); }
    catch (error) {
      signal?.removeEventListener("abort", onLocalAbort);
      parentDisconnectController.signal.removeEventListener("abort", abortWait);
      throw error;
    }
    return whileParentConnected(pending).finally(() => {
      signal?.removeEventListener("abort", onLocalAbort);
      parentDisconnectController.signal.removeEventListener("abort", abortWait);
    });
  };
  const callOwnerTool = async (client, name, arguments_, timeout = TOOL_TIMEOUT_MS) => {
    if (parentDisconnected) throw parentDisconnectedFailure();
    return whileParentConnected(callTool(client, name, arguments_, timeout));
  };
  const callOwnerToolList = async (client) => {
    if (parentDisconnected) throw parentDisconnectedFailure();
    return whileParentConnected(callToolList(client));
  };
  try {
    if (parentDisconnected) throw parentDisconnectedFailure();
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath, args: [SERVER_PATH], cwd: PROJECT_ROOT, env: OWNER_ENV, stderr: "pipe"
    }, dependencies.sdk ?? {});
    const listed = await callOwnerToolList(session.client);
    const toolNames = [...new Set((listed?.tools ?? []).map((tool) => tool?.name).filter((name) => typeof name === "string"))];
    if (listed?.isError === true || !requiredOwnerToolSurface(toolNames)) throw safeFailure("TOOL_SURFACE_INVALID", "TOOL_SURFACE_INVALID");

    const begun = await callOwnerTool(session.client, "syntx_begin_login", {}, TOOL_TIMEOUT_MS);
    attemptId = safeAttempt(begun?.structuredContent?.attempt_id);
    const handoffUri = begun?.content?.find((part) => part?.type === "resource_link")?.uri;
    if (begun?.isError === true || !attemptId || !isSafeHandoffUri(handoffUri)) throw safeFailure("BEGIN_UNAVAILABLE", "BEGIN_UNAVAILABLE");
    beginIntentFingerprint = stageFingerprint("BEGIN", attemptId, metadata.actionFingerprint);
    const beginAck = await waitAndEmit(waitAction, privateSend, "BEGIN", {
      attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint
    }, BEGIN_ACK_TIMEOUT_MS, {
      attempt_id: attemptId, intent_fingerprint: beginIntentFingerprint, handoff_uri: handoffUri,
      ...metadata.safeBase
    });
    if (parentDisconnected) throw parentDisconnectedFailure();
    if (!beginAck || beginAck.action !== "handoff_sent") throw safeFailure("BEGIN_NOT_CONFIRMED", "PRIVATE_ACK_INVALID");
    beginAcknowledged = true;
    if (!await pollLinked(session.client, attemptId, dependencies, callOwnerTool)) throw safeFailure("AUTH_NOT_LINKED", "AUTH_NOT_LINKED");

    readIntentFingerprint = stageFingerprint("READ_ACCOUNT_STATUS", attemptId, metadata.actionFingerprint);
    const readAck = await waitAndEmit(waitAction, privateSend, "READ_INTENT", {
      attempt_id: attemptId, intent_fingerprint: readIntentFingerprint
    }, ACTION_ACK_TIMEOUT_MS, {
      attempt_id: attemptId, intent_fingerprint: readIntentFingerprint,
      read_kind: "account_status", account_status_call_count: 0, ...metadata.safeBase
    });
    if (parentDisconnected) throw parentDisconnectedFailure();
    if (!readAck || readAck.action !== "approve_read") throw safeFailure("READ_NOT_APPROVED", "PRIVATE_ACK_INVALID");
    counts.account_status_call_count += 1;
    let accountStatus;
    try { accountStatus = await callOwnerTool(session.client, "syntx_get_account_status", { link_attempt_id: attemptId }, TOOL_TIMEOUT_MS); }
    catch { throw safeFailure("ACCOUNT_STATUS_UNAVAILABLE", "TRANSPORT_REPLY_LOST"); }
    if (!isActivePaidAccount(accountStatus)) throw safeFailure("ACCOUNT_STATUS_NOT_VERIFIED", parseSafeToolError(accountStatus).code);
    accountReadStatus = "ACTIVE_PAID_READBACK";

    uploadIntentFingerprint = stageFingerprint("UPLOAD", attemptId, metadata.actionFingerprint, {
      upload_sha256: fixture.sha256, upload_byte_size: fixture.bytes.length,
      mime_type: fixture.mime_type, filename: fixture.filename
    });
    const uploadAck = await waitAndEmit(waitAction, privateSend, "UPLOAD_INTENT", {
      attempt_id: attemptId, intent_fingerprint: uploadIntentFingerprint
    }, ACTION_ACK_TIMEOUT_MS, {
      ...metadata.safeBase, attempt_id: attemptId, intent_fingerprint: uploadIntentFingerprint,
      upload_call_count: 0, generation_call_count: 0, retry_count: 0
    });
    if (parentDisconnected) throw parentDisconnectedFailure();
    if (!uploadAck || uploadAck.action !== "approve_upload") throw safeFailure("UPLOAD_NOT_APPROVED", "PRIVATE_ACK_INVALID");

    uploadStarted = true;
    counts.upload_call_count += 1;
    let uploaded;
    try {
      uploaded = await callOwnerTool(session.client, "syntx_upload_clarity_upscale_image", {
        link_attempt_id: attemptId, content_base64: fixture.bytes.toString("base64"),
        filename: fixture.filename, mime_type: fixture.mime_type
      }, TOOL_TIMEOUT_MS);
    } catch { throw safeFailure("UPLOAD_OUTCOME_UNKNOWN", "TRANSPORT_REPLY_LOST"); }
    if (uploaded?.isError === true) {
      const error = parseSafeToolError(uploaded);
      throw safeFailure(error.code === "UPLOAD_REJECTED" ? "UPLOAD_FAILED" :
        error.code === "UPLOAD_OUTCOME_UNKNOWN" ? "UPLOAD_OUTCOME_UNKNOWN" : "UPLOAD_FAILED", error.code);
    }
    uploadReceipt = parseUploadReceipt(uploaded?.structuredContent, fixture);
    if (uploadReceipt === null) throw safeFailure("UPLOAD_RECEIPT_INVALID", "UPLOAD_RECEIPT_INVALID");
    imageHandle = uploadReceipt.image_handle;

    const parametersFingerprint = sha256(Buffer.from(canonicalJson(OWNER_CLARITY_UPSCALE_CASE.parameters), "utf8"));
    generationIntentFingerprint = stageFingerprint("GENERATION", attemptId, metadata.actionFingerprint, {
      image_handle_sha256: sha256(Buffer.from(imageHandle, "utf8")),
      parameters_sha256: parametersFingerprint,
      upload_sha256: uploadReceipt.sha256
    });
    const generationAck = await waitAndEmit(waitAction, privateSend, "GENERATION_INTENT", {
      attempt_id: attemptId, intent_fingerprint: generationIntentFingerprint
    }, ACTION_ACK_TIMEOUT_MS, {
      ...metadata.safeBase, attempt_id: attemptId, intent_fingerprint: generationIntentFingerprint,
      upload_call_count: counts.upload_call_count, generation_call_count: 0, retry_count: 0,
      image_handle_sha256: sha256(Buffer.from(imageHandle, "utf8")), parameters_sha256: parametersFingerprint
    });
    if (!generationAck || generationAck.action !== "approve_generation") throw safeFailure("GENERATION_NOT_APPROVED", "PRIVATE_ACK_INVALID");
    if (parentDisconnected) throw parentDisconnectedFailure();
    try {
      await operatorJournal.append(buildOwnerClarityOperatorJournalCheckpoint({
        metadata, counts, generationDiagnostic, stage: "GENERATION_DISPATCH_POSSIBLE", outcome: "DISPATCH_POSSIBLE",
        localUnlink: "NOT_ATTEMPTED", clientClose: "NOT_ATTEMPTED", childClose: "NOT_ATTEMPTED"
      }));
    } catch {
      journalFailedBeforeGeneration = true;
      throw safeFailure("GENERATION_JOURNAL_FAILED", "OPERATOR_JOURNAL_WRITE_FAILED");
    }
    if (parentDisconnected) throw parentDisconnectedFailure();

    generationStarted = true;
    counts.generation_call_count += 1;
    generationStartedAt = (dependencies.now ?? Date.now)();
    let generated;
    try {
      generated = await callOwnerTool(session.client, "syntx_owner_generate_clarity_upscale_image", {
        link_attempt_id: attemptId, image_handle: imageHandle,
        parameters: { ...OWNER_CLARITY_UPSCALE_CASE.parameters }
      }, GENERATION_TIMEOUT_MS);
    } catch { generated = null; }
    if (parentDisconnected) throw parentDisconnectedFailure();

    let generationError = generated?.isError === true ? parseSafeToolError(generated) :
      generated === null ? { code: "TRANSPORT_REPLY_LOST", recovery_id: null, diagnostic: null } : null;
    if (generationError !== null) {
      generationDiagnostic = generationError.diagnostic;
      if (generated?.isError === true && generationError.code !== "OUTCOME_UNKNOWN") {
        throw safeFailure("GENERATION_FAILED", generationError.code);
      }
      recoveryId = generationError.recovery_id;
      if (recoveryId === null && generated === null) {
        const discoveryFingerprint = stageFingerprint("RECOVERY_DISCOVERY", attemptId, metadata.actionFingerprint);
        const discoveryAck = await waitAndEmit(waitAction, privateSend, "RECOVERY_DISCOVERY_INTENT", {
          attempt_id: attemptId, intent_fingerprint: discoveryFingerprint
        }, ACTION_ACK_TIMEOUT_MS, {
          ...metadata.safeBase, attempt_id: attemptId, intent_fingerprint: discoveryFingerprint,
          status: "OUTCOME_UNKNOWN", recovery_discovery_call_count: 0, generation_call_count: counts.generation_call_count,
          retry_count: 0
        });
        if (parentDisconnected) throw parentDisconnectedFailure();
        if (discoveryAck?.action !== "discover") throw safeFailure("GENERATION_OUTCOME_UNKNOWN", generationError.code);
        counts.recovery_discovery_call_count += 1;
        let listing;
        try {
          listing = await callOwnerTool(session.client, "syntx_owner_list_clarity_upscale_recoveries", {
            link_attempt_id: attemptId, limit: 20
          }, TOOL_TIMEOUT_MS);
        } catch { throw safeFailure("GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", "RECOVERY_LIST_UNAVAILABLE"); }
        const discovered = findUniqueRecoveryId(listing, generationStartedAt, (dependencies.now ?? Date.now)());
        recoveryId = discovered?.recovery_id ?? null;
        if (generationDiagnostic === null && discovered?.diagnostic) generationDiagnostic = discovered.diagnostic;
      }
      if (recoveryId === null) throw safeFailure("GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", generationError.code);
      const recoveryFingerprint = stageFingerprint("RECONCILE", attemptId, metadata.actionFingerprint, {
        recovery_id_sha256: sha256(Buffer.from(recoveryId, "utf8"))
      });
      const recoveryAction = await waitAndEmit(waitAction, privateSend, "RECOVERY_ACTION", {
        attempt_id: attemptId, recovery_id: recoveryId, intent_fingerprint: recoveryFingerprint
      }, ACTION_ACK_TIMEOUT_MS, {
        ...metadata.safeBase, attempt_id: attemptId, recovery_id: recoveryId,
        intent_fingerprint: recoveryFingerprint, status: "OUTCOME_UNKNOWN", retry_count: 0
      });
      if (parentDisconnected) throw parentDisconnectedFailure();
      if (recoveryAction?.action !== "reconcile") throw safeFailure("GENERATION_OUTCOME_UNKNOWN", generationError.code);
      counts.recovery_call_count += 1;
      try {
        generated = await callOwnerTool(session.client, "syntx_owner_reconcile_clarity_upscale_image", {
          link_attempt_id: attemptId, recovery_id: recoveryId
        }, RECONCILE_TIMEOUT_MS);
      } catch { throw safeFailure("GENERATION_OUTCOME_UNKNOWN", "TRANSPORT_REPLY_LOST"); }
      if (generated?.isError === true) {
        const reconciledError = parseSafeToolError(generated);
        if (reconciledError.diagnostic !== null) generationDiagnostic = reconciledError.diagnostic;
        throw safeFailure("GENERATION_OUTCOME_UNKNOWN", reconciledError.code);
      }
    }

    if (parentDisconnected) throw parentDisconnectedFailure();
    const decoded = parseGenerationResult(generated?.structuredContent, source, uploadReceipt);
    if (decoded === null) throw safeFailure("GENERATION_RESULT_INVALID", "GENERATION_RESULT_INVALID");
    generationResult = decoded.safe;
    artifactUrl = decoded.artifactUrl;
    if (decoded.artifactMime !== null) {
      counts.artifact_observation_count += 1;
      let observation;
      try {
        observation = await whileParentConnected((dependencies.observeOwnedImageArtifact ?? defaultObserveOwnedImageArtifact)({
          artifacts: [{ url: decoded.artifactUrl, mime_type: decoded.artifactMime }]
        }));
      } catch { observation = null; }
      observedArtifact = parseArtifactObservation(observation, decoded.artifactMime);
    }
    status = observedArtifact === null ? "RESULT_BYTES_UNVERIFIED" :
      observedArtifact.width !== 1024 || observedArtifact.height !== 1024
        ? "ARTIFACT_GEOMETRY_MISMATCH" : "PASS_FIXED_CASE_RESULT_ONLY";
  } catch (error) {
    status = error?.safeStatus ?? (generationStarted ? "GENERATION_OUTCOME_UNKNOWN" : uploadStarted ? "UPLOAD_OUTCOME_UNKNOWN" : "FAILED");
    failureStage = error?.safeStage ?? inferFailureStage(status);
    failureCode = error?.safeCode ?? safeFailureCode(error);
  } finally {
    if (attemptId && session?.client) localUnlink = await unlinkAndReadBack(session.client, attemptId);
    if (session) {
      clientClose = await closeOwnerClientBounded(session.client) ? "CLOSED" : "UNCONFIRMED";
      try { childClose = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED"; } catch { childClose = "UNCONFIRMED"; }
    }
    if (observeDisconnect) io.off("disconnect", onParentDisconnect);
  }
  if (status === "PASS_FIXED_CASE_RESULT_ONLY" &&
      (localUnlink !== "REVOKED_READBACK_CONFIRMED" || clientClose !== "CLOSED" || childClose !== "CLOSED")) status = "PASS_CLEANUP_UNCONFIRMED";
  if (!journalFailedBeforeGeneration) {
    try {
      await operatorJournal.append(buildOwnerClarityOperatorJournalCheckpoint({
        metadata, counts, generationDiagnostic, stage: "FINAL_OUTCOME", outcome: ownerClarityJournalOutcome(status, generationStarted),
        localUnlink, clientClose, childClose
      }));
    } catch {
      failureCode = "OPERATOR_JOURNAL_WRITE_FAILED";
      failureStage = generationStarted ? "GENERATION" : "OWNER_OPERATION";
      if (generationStarted) {
        status = "GENERATION_OUTCOME_UNKNOWN";
        generationResult = null;
        observedArtifact = null;
        artifactUrl = null;
      } else {
        status = "OPERATOR_JOURNAL_FAILED";
      }
    }
  }
  const result = {
    ...metadata.safeBase,
    ...counts,
    action_fingerprint: metadata.actionFingerprint,
    begin_intent_fingerprint: beginIntentFingerprint,
    read_intent_fingerprint: readIntentFingerprint,
    upload_intent_fingerprint: uploadIntentFingerprint,
    generation_intent_fingerprint: generationIntentFingerprint,
    begin_acknowledged: beginAcknowledged,
    account_status_read: accountReadStatus,
    upload_receipt: uploadReceipt === null ? null : uploadReceipt.safe,
    generation_result: generationResult,
    generation_diagnostic: generationDiagnostic,
    artifact_observation: observedArtifact,
    failure_stage: failureStage,
    failure_code: failureCode,
    status,
    local_unlink_status: localUnlink,
    client_close_status: clientClose,
    child_close_status: childClose,
    mutation_calls: Object.freeze({ upload: counts.upload_call_count, generation: counts.generation_call_count,
      delete: 0, training: 0, retry: 0 })
  };
  const serialized = JSON.stringify(result);
  result.stdout_includes_private_data = serialized.includes(fixture.bytes.toString("base64")) ||
    (attemptId !== null && serialized.includes(attemptId)) ||
    (imageHandle !== null && serialized.includes(imageHandle)) ||
    (recoveryId !== null && serialized.includes(recoveryId)) ||
    (artifactUrl !== null && serialized.includes(artifactUrl)) || serialized.includes("https://");
  return summary(status, result);
}

function buildOwnerClarityOperatorJournalCheckpoint({ metadata, counts, generationDiagnostic, stage, outcome,
  localUnlink, clientClose, childClose }) {
  const safe = metadata.safeBase;
  return Object.freeze({
    case_id: safe.case_id,
    source_fingerprint: safe.source_fingerprint,
    profile_schema_hash: safe.profile_schema_hash,
    fixture_sha256: safe.fixture_sha256,
    fixture_pixel_sha256: safe.fixture_pixel_sha256,
    harness_sha256: safe.harness_sha256,
    runtime_node_version: safe.runtime_node_version,
    action_fingerprint: metadata.actionFingerprint,
    stage, outcome,
    upload_call_count: counts.upload_call_count,
    generation_call_count: counts.generation_call_count,
    recovery_discovery_call_count: counts.recovery_discovery_call_count,
    recovery_call_count: counts.recovery_call_count,
    artifact_observation_count: counts.artifact_observation_count,
    retry_count: counts.retry_count,
    generation_diagnostic: generationDiagnostic ?? null,
    local_unlink_status: localUnlink,
    client_close_status: clientClose,
    child_close_status: childClose
  });
}

function ownerClarityJournalOutcome(status, generationStarted) {
  if (!generationStarted) return "PRE_GENERATION_FAILED";
  if (status === "PASS_FIXED_CASE_RESULT_ONLY") return "RESULT_OBSERVED_CLEANUP_CONFIRMED";
  if (status === "PASS_CLEANUP_UNCONFIRMED") return "RESULT_OBSERVED_CLEANUP_UNCONFIRMED";
  if (["RESULT_BYTES_UNVERIFIED", "ARTIFACT_GEOMETRY_MISMATCH", "GENERATION_RESULT_INVALID", "GENERATION_FAILED"].includes(status)) return status;
  return "OUTCOME_UNKNOWN";
}

async function closeOwnerClientBounded(client) {
  let timer;
  const close = Promise.resolve().then(() => client.close()).then(() => true, () => false);
  const timeout = new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), CHILD_CLOSE_TIMEOUT_MS); });
  try { return await Promise.race([close, timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

function requiredOwnerToolSurface(names) {
  return OWNER_TOOL_NAMES.every((name) => names.includes(name));
}

function safeAttempt(value) { return typeof value === "string" && ATTEMPT_PATTERN.test(value) ? value : null; }

function isSafeHandoffUri(value) {
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" && ["t.me", "telegram.me"].includes(uri.hostname) && !uri.username && !uri.password;
  } catch { return false; }
}

function stageFingerprint(stage, attemptId, actionFingerprint, extra = {}) {
  return sha256(Buffer.from(canonicalJson({ stage, attempt_id: attemptId,
    action_fingerprint: actionFingerprint, ...extra }), "utf8"));
}

function safeFailure(status, code) {
  const error = new Error("SAFE_OWNER_OPERATION_FAILURE");
  error.safeStatus = status;
  error.safeCode = typeof code === "string" && SAFE_CODE.test(code) ? code : "TOOL_ERROR";
  return error;
}

function safeFailureCode(error) {
  return error && typeof error === "object" && typeof error.safeCode === "string" && SAFE_CODE.test(error.safeCode)
    ? error.safeCode : null;
}

function inferFailureStage(status) {
  if (status.startsWith("UPLOAD")) return "UPLOAD";
  if (status.startsWith("GENERATION")) return "GENERATION";
  if (status.startsWith("ACCOUNT")) return "ACCOUNT_STATUS";
  if (status.startsWith("AUTH")) return "AUTH";
  return "OWNER_OPERATION";
}

function parseSafeToolError(result) {
  try {
    const content = readOwnDataField(result, "content");
    if (!Array.isArray(content) || types.isProxy(content) || content.length > 32) return { code: "TOOL_ERROR", recovery_id: null, diagnostic: null };
    let text;
    for (let index = 0; index < content.length; index += 1) {
      const entryDescriptor = Object.getOwnPropertyDescriptor(content, String(index));
      if (!entryDescriptor || !("value" in entryDescriptor)) continue;
      const entry = entryDescriptor.value;
      if (readOwnDataField(entry, "type") === "text") {
        const candidate = readOwnDataField(entry, "text");
        if (typeof candidate === "string") { text = candidate; break; }
      }
    }
    const parsed = JSON.parse(typeof text === "string" ? text : "{}");
    const error = parsed?.error;
    const code = typeof error?.code === "string" && SAFE_CODE.test(error.code) ? error.code : "TOOL_ERROR";
    const recoveryId = typeof error?.recovery_id === "string" && RECOVERY_PATTERN.test(error.recovery_id)
      ? error.recovery_id : null;
    const diagnostic = code === "OUTCOME_UNKNOWN" ? snapshotClarityDiagnostic(error?.diagnostic) : null;
    return { code, recovery_id: recoveryId, diagnostic };
  } catch { return { code: "TOOL_ERROR", recovery_id: null, diagnostic: null }; }
}

function parseUploadReceipt(value, fixture) {
  const receipt = readExactSafeDataRecord(value, [
    "status", "image_handle", "mime_type", "size", "width", "height", "sha256", "expires_in_seconds",
    "confidence_scope", "metadata_confidence", "upload_destination", "destination_source_binding", "coverage"
  ]);
  if (!receipt || receipt.status !== "accepted" || typeof receipt.image_handle !== "string" ||
      !IMAGE_HANDLE_PATTERN.test(receipt.image_handle) || receipt.mime_type !== fixture.mime_type ||
      receipt.size !== fixture.bytes.length || receipt.width !== fixture.width || receipt.height !== fixture.height ||
      receipt.sha256 !== fixture.sha256 || receipt.expires_in_seconds !== 900 ||
      receipt.confidence_scope !== "input_bytes_sniffed_and_dimensions_checked" ||
      receipt.metadata_confidence !== "CONTAINER_METADATA_ONLY" || receipt.upload_destination !== "uploaded" ||
      receipt.destination_source_binding !== "root347_clarity_default_upload") return null;
  const coverage = readExactSafeDataRecord(receipt.coverage, [
    "source_mime_types", "source_max_bytes", "implemented_mime_types", "implemented_max_bytes", "status",
    "upload_destination", "destination_source_binding"
  ]);
  const expectedMimeTypes = ["image/jpeg", "image/png", "image/avif", "image/webp"];
  if (!coverage || !exactStringArray(coverage.source_mime_types, expectedMimeTypes) ||
      coverage.source_max_bytes !== 25 * 1024 * 1024 || !exactStringArray(coverage.implemented_mime_types, expectedMimeTypes) ||
      coverage.implemented_max_bytes !== 25 * 1024 * 1024 ||
      coverage.status !== "STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE" ||
      coverage.upload_destination !== "uploaded" || coverage.destination_source_binding !== "root347_clarity_default_upload") return null;
  return Object.freeze({ image_handle: receipt.image_handle, sha256: receipt.sha256, safe: Object.freeze({
    status: receipt.status, mime_type: receipt.mime_type, size: receipt.size, width: receipt.width, height: receipt.height,
    sha256: receipt.sha256, expires_in_seconds: receipt.expires_in_seconds,
    confidence_scope: receipt.confidence_scope, metadata_confidence: receipt.metadata_confidence,
    upload_destination: receipt.upload_destination, destination_source_binding: receipt.destination_source_binding,
    coverage: Object.freeze({
      source_mime_types: Object.freeze(expectedMimeTypes), source_max_bytes: coverage.source_max_bytes,
      implemented_mime_types: Object.freeze(expectedMimeTypes), implemented_max_bytes: coverage.implemented_max_bytes,
      status: coverage.status, upload_destination: coverage.upload_destination,
      destination_source_binding: coverage.destination_source_binding
    })
  }) });
}

function exactStringArray(value, expected) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length !== expected.length) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expected.length + 1 || !("length" in descriptors) ||
        keys.some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/u.test(key)))) return false;
    for (let index = 0; index < expected.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value !== expected[index]) return false;
    }
    return true;
  } catch { return false; }
}

function parseGenerationResult(value, source, uploadReceipt) {
  if (!value || typeof value !== "object" || value.status !== "result_observed" || value.backend_acceptance !== "unproven" ||
      value.model_id !== "clarity" || value.operation_id !== "upscale-image" || value.profile_id !== source.profile_id ||
      value.profile_schema_hash !== source.profile_schema_hash || value.catalog_version !== source.catalog_version ||
      !/^sha256:[a-f0-9]{64}$/u.test(value.request_fingerprint ?? "") || value.requested_scale_factor !== 2 ||
      value.geometry_verified !== false || value.input_image?.mime_type !== "image/png" || value.input_image?.width !== 512 ||
      value.input_image?.height !== 512 || value.actual_image?.width !== null || value.actual_image?.height !== null ||
      ![null, "image/png", "image/jpeg", "image/webp"].includes(value.actual_image?.mime_type) ||
      value.expected_output_geometry?.width !== 1024 || value.expected_output_geometry?.height !== 1024 ||
      !value.artifact || typeof value.artifact.url !== "string" ||
      !["URL_EXTENSION_ONLY", "UNKNOWN"].includes(value.artifact.mime_confidence) ||
      ![null, "image/png", "image/jpeg", "image/webp"].includes(value.artifact.mime_type)) return null;
  let url;
  try { url = new URL(value.artifact.url); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || !uploadReceipt?.sha256) return null;
  return Object.freeze({ artifactUrl: value.artifact.url, artifactMime: value.artifact.mime_type,
    safe: Object.freeze({ status: value.status, backend_acceptance: value.backend_acceptance,
      model_id: value.model_id, operation_id: value.operation_id, profile_id: value.profile_id,
      profile_schema_hash: value.profile_schema_hash, catalog_version: value.catalog_version,
      request_fingerprint: value.request_fingerprint, requested_scale_factor: value.requested_scale_factor,
      input_image: Object.freeze({ ...value.input_image }), expected_output_geometry: Object.freeze({ ...value.expected_output_geometry }),
      actual_image: Object.freeze({ ...value.actual_image }), geometry_verified: false,
      artifact: Object.freeze({ mime_type: value.artifact.mime_type, mime_confidence: value.artifact.mime_confidence }) }) });
}

function findUniqueRecoveryId(result, startedAt, now) {
  if (readOwnDataField(result, "isError") === true) return null;
  const structured = readOwnDataField(result, "structuredContent");
  const list = readExactSafeDataRecord(structured, ["recoveries", "confidence_scope", "expires_in_seconds"]);
  const records = list?.recoveries;
  if (!list || list.confidence_scope !== "process_local_get_only_recovery" || list.expires_in_seconds !== 900 ||
      !Array.isArray(records) || types.isProxy(records) || records.length !== 1) return null;
  let recordValue;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(records, "0");
    if (!descriptor || !("value" in descriptor)) return null;
    recordValue = descriptor.value;
  } catch { return null; }
  const record = readExactSafeDataRecord(recordValue, [
    "recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"
  ]);
  if (!record || !RECOVERY_PATTERN.test(record.recovery_id ?? "") || record.model_id !== "clarity" ||
      record.operation_id !== "upscale-image" || record.status !== "OUTCOME_UNKNOWN" ||
      typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at)) ||
      Date.parse(record.created_at) < startedAt - 60_000 || Date.parse(record.created_at) > now + 60_000) return null;
  return Object.freeze({ recovery_id: record.recovery_id, diagnostic: snapshotClarityDiagnostic(record.diagnostic) });
}

function parseArtifactObservation(value, declaredMime) {
  if (!value || value.status !== "OBSERVED" || value.mime !== declaredMime || value.declared_mime !== declaredMime ||
      !Number.isSafeInteger(value.byte_size) || value.byte_size < 1 || !Number.isSafeInteger(value.width) || value.width < 1 ||
      !Number.isSafeInteger(value.height) || value.height < 1 || !/^sha256:[a-f0-9]{64}$/u.test(value.sha256 ?? "")) return null;
  return Object.freeze({ status: "OBSERVED", mime: value.mime, byte_size: value.byte_size,
    width: value.width, height: value.height, sha256: value.sha256 });
}

async function defaultObserveOwnedImageArtifact(input) {
  const { observeOwnedImageArtifact } = await import("../dist/src/adapter/syntx/owned-image-artifact-observer.js");
  return observeOwnedImageArtifact(input, { maxBytes: ARTIFACT_OBSERVATION_CAP });
}

function waitAndEmit(waitAction, send, event, context, timeout, emitFields) {
  const controller = new AbortController();
  let pending;
  try { pending = Promise.resolve(waitAction(event, context, timeout, controller.signal)); }
  catch (error) { controller.abort(); throw error; }
  const observed = pending.catch(() => null);
  return (async () => {
    try {
      if (await send({ event, ...emitFields }, 5_000) !== true) throw new Error("PRIVATE_IPC_SEND_FAILED");
    } catch (error) { controller.abort(); void observed; throw error; }
    const ack = await observed;
    const expectedAction = { BEGIN: "handoff_sent", READ_INTENT: "approve_read", UPLOAD_INTENT: "approve_upload",
      GENERATION_INTENT: "approve_generation", RECOVERY_DISCOVERY_INTENT: "discover", RECOVERY_ACTION: "reconcile" }[event];
    if (!ack || ack.action !== expectedAction || ack.attempt_id !== context.attempt_id ||
        ack.intent_fingerprint !== context.intent_fingerprint ||
        (context.recovery_id !== undefined && ack.recovery_id !== context.recovery_id)) return null;
    return ack;
  })();
}

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
      const expectedAction = { BEGIN: "handoff_sent", READ_INTENT: "approve_read", UPLOAD_INTENT: "approve_upload",
        GENERATION_INTENT: "approve_generation", RECOVERY_DISCOVERY_INTENT: "discover", RECOVERY_ACTION: "reconcile" }[event];
      if (message.action === expectedAction && message.attempt_id === context.attempt_id &&
          message.intent_fingerprint === context.intent_fingerprint &&
          (context.recovery_id === undefined || message.recovery_id === context.recovery_id)) finish(message);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs); timer.unref?.();
    io.on("message", onMessage); signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function pollLinked(client, attemptId, dependencies, call = callTool) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? delay;
  const deadline = now() + LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    await sleep(LOGIN_POLL_MS);
    const result = await call(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    const value = result?.structuredContent;
    if (result?.isError === true || value?.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(value.status)) return false;
  }
  return false;
}

function isActivePaidAccount(result) {
  const subscription = result?.structuredContent?.subscription;
  return result?.isError !== true && subscription?.active === true && typeof subscription.plan_type === "string" &&
    subscription.plan_type.trim().length > 0 && subscription.plan_type.trim().toUpperCase() !== "FREE";
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
