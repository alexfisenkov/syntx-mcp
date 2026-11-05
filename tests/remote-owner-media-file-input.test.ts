import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { CivitaiPinnedHttpsDownloadTransportPorts, CivitaiPinnedHttpsRawResponse } from "../src/adapter/civitai/pinned-https-download-transport.js";
import { describeRemoteMediaFileTool, resolveRemoteMediaFileArguments, RemoteOwnerMediaFileInputError } from "../src/runtime/remote-owner-media-file-input.js";
import { validateOwnerStandardImageAuxInput } from "../src/application/owner-standard-image-aux-input-validator.js";
import { validateOwnerStandardImageInput } from "../src/application/owner-standard-image-input-validator.js";

const URL = "https://files.oaiusercontent.com/attachment?signature=PRIVATE_DO_NOT_LOG";
const file = () => ({ download_url: URL, file_id: "file-synthetic" });
const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");
const MP4 = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");
const WAV = Buffer.from("RIFF0000WAVEfmt synthetic audio", "latin1");
const PDF = Buffer.from("%PDF-1.7\nsynthetic\n%%EOF");
function tool(name = "syntx_owner_upload_flux3_video_reference", mime = "image/png", maxChars = 4096): Tool {
  return { name, description: "Canonical upload", annotations: { readOnlyHint: false },
    inputSchema: { type: "object", additionalProperties: false,
      properties: { link_attempt_id: { type: "string", pattern: "^link_" }, model_id: { const: "model" },
        content_base64: { type: "string", minLength: 4, maxLength: maxChars }, filename: { type: "string", minLength: 1, maxLength: 255 },
        mime_type: { type: "string", enum: [mime] }, role: { type: "string", enum: ["reference", "mask"] } },
      required: ["link_attempt_id", "model_id", "content_base64", "filename", "mime_type"] },
    outputSchema: { type: "object", properties: { reference_handle: { type: "string" } } },
    _meta: { "vendor/retained": { value: 7 } } };
}
function nativeStandard(): Tool {
  const original = tool("syntx_upload_standard_image_reference");
  original.inputSchema.properties = { link_attempt_id: { type: "string" }, variant: { enum: ["banana-2.1", "gpt-image-2"] },
    content_base64: { type: "string", minLength: 4, maxLength: 44_739_244 }, filename: { type: "string", minLength: 1, maxLength: 255 },
    mime_type: { type: "string", enum: ["image/png", "video/mp4", "application/pdf"] },
    file: { type: "object", additionalProperties: false, properties: {
      download_url: { type: "string" }, file_id: { type: "string" }, mime_type: { type: "string" }, file_name: { type: "string" }
    }, required: ["download_url", "file_id"] } };
  original.inputSchema.required = ["link_attempt_id", "variant"];
  original._meta = { "openai/fileParams": ["file"], "vendor/retain": true };
  return original;
}
const other = { link_attempt_id: "link_synthetic_0123456789", model_id: "model", role: "reference" };
function fixture(bytes = PNG, changes: Partial<CivitaiPinnedHttpsRawResponse> = {}) {
  const raw = Buffer.from(bytes);
  const counts = { dns: 0, request: 0, cancel: 0 };
  const ports: CivitaiPinnedHttpsDownloadTransportPorts = {
    async dnsLookup(hostname) { counts.dns++; assert.equal(hostname, "files.oaiusercontent.com"); return [{ address: "1.1.1.1", family: 4 }]; },
    async request(options) {
      counts.request++;
      assert.equal(options.hostname, "files.oaiusercontent.com"); assert.equal(options.servername, options.hostname);
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
      assert.deepEqual(options.headers, { accept: "*/*", "accept-encoding": "identity" });
      options.lookup(options.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null); assert.deepEqual(addresses, [{ address: "1.1.1.1", family: 4 }]);
      });
      return { statusCode: 200, headers: { "content-type": "application/octet-stream", "content-length": String(raw.length) },
        remoteAddress: "1.1.1.1", tlsAuthorized: true, body: (async function* () { yield raw; })(),
        async cancel() { counts.cancel++; }, ...changes };
    }
  };
  return { ports, counts, raw };
}
async function rejected(operation: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof RemoteOwnerMediaFileInputError);
    assert.equal(error.code, code);
    assert.equal(`${error.stack}${JSON.stringify(error)}`.includes("PRIVATE_DO_NOT_LOG"), false);
    assert.equal(error.message.includes("https://"), false);
    return true;
  });
}

test("gateway descriptor adds the four-property strict OpenAI file input while preserving canonical metadata and other constraints", () => {
  for (const [name, mime] of [["syntx_upload_flux_image_reference", "image/png"], ["syntx_owner_upload_suno_audio_reference", "audio/wav"],
    ["syntx_owner_upload_seedance_editor_video", "video/mp4"], ["syntx_upload_banana_inpaint_auxiliary_reference", "application/pdf"]]) {
    const original = tool(name, mime), before = structuredClone(original);
    const facade = describeRemoteMediaFileTool(original);
    assert.deepEqual(original, before);
    assert.equal(facade.outputSchema, original.outputSchema); assert.equal(facade.annotations, original.annotations);
    assert.deepEqual(facade._meta, { ...original._meta, "openai/fileParams": ["file"] });
    assert.deepEqual(facade.inputSchema.required, ["link_attempt_id", "model_id"]);
    const props = facade.inputSchema.properties!;
    for (const key of Object.keys(original.inputSchema.properties!)) assert.equal(props[key], original.inputSchema.properties![key]);
    const attachment = props.file as { properties: object; required: string[]; additionalProperties: boolean };
    assert.deepEqual(Object.keys(attachment.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
    assert.deepEqual(attachment.required, ["download_url", "file_id"]); assert.equal(attachment.additionalProperties, false);
    assert.ok(Array.isArray(facade.inputSchema.allOf));
  }
});

test("conditional upload variants admit file mode and retain model-specific byte requirements and strict fields", () => {
  const source = tool("syntx_upload_seedream_editor_original");
  source.inputSchema.properties!.variant = { type: "string", enum: ["seedream-4", "seedream-5.0-flash"] };
  source.inputSchema.required!.push("variant");
  source.inputSchema.oneOf = ["seedream-4", "seedream-5.0-flash"].map(variant => ({
    type: "object", additionalProperties: false,
    properties: { ...source.inputSchema.properties, variant: { const: variant, type: "string" } },
    required: [...source.inputSchema.required!]
  }));
  const original = structuredClone(source);
  const described = describeRemoteMediaFileTool(source);
  const validate = new AjvJsonSchemaValidator().getValidator(described.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
  for (const variant of ["seedream-4", "seedream-5.0-flash"]) {
    assert.equal(validate({ ...other, variant, file: file() }).valid, true);
    assert.equal(validate({ ...other, variant, filename: "input.png", mime_type: "image/png", content_base64: PNG.toString("base64") }).valid, true);
    assert.equal(validate({ ...other, variant, file: file(), filename: "ambiguous.png" }).valid, false);
    assert.equal(validate({ ...other, variant, file: file(), extra: true }).valid, false);
    assert.equal(validate({ ...other, variant }).valid, false);
  }
  assert.equal(validate({ ...other, variant: "unreviewed", file: file() }).valid, false);
  assert.deepEqual(source, original);
});

test("already-native standard image descriptor, non-upload tools and unbounded schemas stay byte-for-byte unchanged", async () => {
  const native = nativeStandard();
  assert.equal(describeRemoteMediaFileTool(native), native);
  for (const original of [tool("syntx_owner_generate_flux_image"), tool("syntx_unknown_upload"),
    { ...tool(), inputSchema: { ...tool().inputSchema, properties: { ...tool().inputSchema.properties, content_base64: { type: "string" } } } }]) {
    assert.equal(describeRemoteMediaFileTool(original), original);
    const f = fixture();
    const resolved = await resolveRemoteMediaFileArguments(original, { ...other, file: file() }, { ports: f.ports });
    assert.deepEqual(resolved.arguments, { ...other, file: file() }); resolved.dispose();
    assert.equal(f.counts.dns, 0);
  }
});

test("native standard file descriptors stay unchanged while Banana PDF/video and image parity use actual child validators", async () => {
  const original = nativeStandard(), before = structuredClone(original);
  const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  const video = Buffer.concat([MP4, Buffer.from("000000096d64617401000000086d6f6f76", "hex")]);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n30\n%%EOF\n");
  for (const [mime, bytes, variant, kind] of [["application/pdf", pdf, "banana-2.1", "file"],
    ["video/mp4", video, "banana-2.1", "video"], ["image/png", validPng, "gpt-image-2", "image"]] as const) {
    const f = fixture(bytes), args = { link_attempt_id: other.link_attempt_id, variant, file: file() };
    const prepared = await resolveRemoteMediaFileArguments(original, args, { ports: f.ports });
    const canonical = prepared.arguments;
    assert.equal(canonical.mime_type, mime);
    assert.equal(Object.hasOwn(canonical, "file"), false);
    const input = { variant, content_base64: canonical.content_base64, filename: canonical.filename, mime_type: canonical.mime_type };
    const validated = kind === "image" ? validateOwnerStandardImageInput(input) : validateOwnerStandardImageAuxInput(input);
    try { assert.equal(validated.kind, kind); assert.deepEqual(Buffer.from(validated.bytes), bytes); }
    finally { validated.bytes.fill(0); prepared.dispose(); }
    assert.equal(f.counts.request, 1);
  }
  assert.equal(describeRemoteMediaFileTool(original), original); assert.deepEqual(original, before);
  const dual = fixture();
  await rejected(resolveRemoteMediaFileArguments(original, { link_attempt_id: other.link_attempt_id, variant: "banana-2.1",
    file: file(), filename: "ambiguous.png" }, { ports: dual.ports }), "INVALID_FILE_INPUT");
  assert.equal(dual.counts.dns, 0);
});

test("Switchx inline byte intake gains fileParams while preserving its prompt and single canonical child arguments", async () => {
  const source = tool("syntx_owner_generate_switchx_video", "video/mp4");
  source.inputSchema.properties!.prompt = { type: "string", maxLength: 1000 };
  source.inputSchema.required!.push("prompt");
  assert.deepEqual(describeRemoteMediaFileTool(source)._meta?.["openai/fileParams"], ["file"]);
  const f = fixture(MP4), prepared = await resolveRemoteMediaFileArguments(source, { ...other, prompt: "Synthetic lighting", file: file() }, { ports: f.ports });
  try { assert.equal(prepared.arguments.prompt, "Synthetic lighting"); assert.equal(prepared.arguments.content_base64, MP4.toString("base64")); }
  finally { prepared.dispose(); }
});

test("image/video/audio/PDF attachments become exact canonical bytes for one child call and dispose removes only temporary Base64", async () => {
  for (const [mime, ext, bytes] of [["image/png", "png", PNG], ["video/mp4", "mp4", MP4], ["audio/wav", "wav", WAV], ["application/pdf", "pdf", PDF]] as const) {
    const f = fixture(bytes), original = { ...other, file: file() };
    const prepared = await resolveRemoteMediaFileArguments(tool(undefined, mime), original, { ports: f.ports });
    let childCalls = 0;
    const child = (args: Record<string, unknown>) => {
      childCalls++; assert.deepEqual(args, { ...other, filename: `attachment.${ext}`, mime_type: mime, content_base64: bytes.toString("base64") });
    };
    try { child(prepared.arguments); } finally { prepared.dispose(); }
    assert.equal(childCalls, 1); assert.deepEqual(prepared.arguments, { ...other, filename: `attachment.${ext}`, mime_type: mime });
    prepared.dispose(); assert.deepEqual(original.file, file());
    assert.equal(f.raw.every(byte => byte === 0), true); assert.deepEqual(f.counts, { dns: 1, request: 1, cancel: 1 });
  }
});

test("the canonical byte path is unchanged and cannot be combined with any attachment field", async () => {
  const f = fixture(), original = { ...other, filename: "input.png", mime_type: "image/png", content_base64: PNG.toString("base64") };
  const resolved = await resolveRemoteMediaFileArguments(tool(), original, { ports: f.ports });
  assert.deepEqual(resolved.arguments, original); resolved.dispose(); assert.deepEqual(resolved.arguments, original);
  for (const key of ["content_base64", "filename", "mime_type"]) await rejected(resolveRemoteMediaFileArguments(tool(),
    { ...other, file: file(), [key]: "input" }, { ports: f.ports }), "INVALID_FILE_INPUT");
  await rejected(resolveRemoteMediaFileArguments(tool(), other, { ports: f.ports }), "INVALID_FILE_INPUT");
  assert.equal(f.counts.dns, 0);
});

test("MIME literal/union constraints and canonical MP3 aliases remain bounded by each child schema", async () => {
  const source = tool("syntx_owner_upload_suno_audio_reference", "audio/mp3");
  source.inputSchema.properties!.mime_type = { anyOf: [{ const: "audio/mp3", type: "string" }, { const: "audio/wav", type: "string" }] };
  const f = fixture(Buffer.from("ID3 synthetic MP3"), { headers: { "content-type": "audio/mpeg" } });
  const prepared = await resolveRemoteMediaFileArguments(source, { ...other, file: file() }, { ports: f.ports });
  try { assert.equal(prepared.arguments.mime_type, "audio/mp3"); assert.equal(prepared.arguments.filename, "attachment.mp3"); }
  finally { prepared.dispose(); }
  const bad = fixture(PNG);
  await rejected(resolveRemoteMediaFileArguments(source, { ...other, file: file() }, { ports: bad.ports }), "FILE_TYPE_MISMATCH");
});

test("current WAN T2V audio and Seedance frame names gain fileParams while preserving their native model and lineage arguments", async () => {
  for (const [name, mime, bytes] of [
    ["syntx_owner_upload_wan_t2v_audio", "audio/wav", WAV],
    ["syntx_owner_upload_seedance_editor_frame", "image/png", PNG]
  ] as const) {
    const source = tool(name, mime);
    delete source.inputSchema.properties!.role;
    const isFrame = mime === "image/png";
    source.inputSchema.properties!.model_id = isFrame ? { type: "string", const: "seedance-2.5-editor" } :
      { type: "string", enum: ["wan_26_t2v", "wan_27_t2v"] };
    source.inputSchema.properties!.mime_type = isFrame ? { type: "string", const: "image/png" } :
      { type: "string", enum: ["audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav"] };
    source.inputSchema.properties!.filename = { type: "string", minLength: 1, maxLength: isFrame ? 128 : 255 };
    source.inputSchema.properties!.content_base64 = { type: "string", minLength: isFrame ? 4 : 24,
      maxLength: isFrame ? Math.ceil(20 * 1024 * 1024 / 3) * 4 : Math.ceil(15_728_640 / 3) * 4 };
    if (isFrame) {
      source.inputSchema.properties!.time_seconds = { type: "number", minimum: 0, maximum: 30 };
      source.inputSchema.properties!.reference_handle = { type: "string" };
      source.inputSchema.required!.push("time_seconds", "reference_handle");
    }
    const described = describeRemoteMediaFileTool(source);
    assert.deepEqual(described._meta?.["openai/fileParams"], ["file"]);
    const lineage = isFrame ? { time_seconds: 1.25,
      reference_handle: "seedance_editor_reference_00000000-0000-4000-8000-000000000001" } : {};
    const fields = { link_attempt_id: other.link_attempt_id, model_id: isFrame ? "seedance-2.5-editor" : "wan_26_t2v", ...lineage, file: file() };
    const f = fixture(bytes);
    const prepared = await resolveRemoteMediaFileArguments(source, fields, { ports: f.ports });
    try {
      assert.equal(prepared.arguments.model_id, fields.model_id);
      if (isFrame) { assert.equal(prepared.arguments.time_seconds, 1.25); assert.equal(prepared.arguments.reference_handle, lineage.reference_handle); }
      assert.equal(prepared.arguments.mime_type, mime);
      assert.equal(prepared.arguments.content_base64, bytes.toString("base64"));
    } finally { prepared.dispose(); }
    if (isFrame) {
      const refused = fixture(bytes);
      await rejected(resolveRemoteMediaFileArguments(source, { link_attempt_id: other.link_attempt_id, model_id: fields.model_id, file: file() },
        { ports: refused.ports }), "INVALID_FILE_INPUT");
      assert.equal(refused.counts.dns, 0);
    }
  }
});

test("Ideogram painted RGBA mask file mode forwards only its original canonical byte field and owned base handle", async () => {
  const source: Tool = { name: "syntx_upload_ideogram_mask", inputSchema: { type: "object", additionalProperties: false,
    properties: { link_attempt_id: { type: "string", pattern: "^link_[A-Za-z0-9_-]{20,120}$" },
      base_reference_handle: { type: "string", pattern: "^ideogram_image_[0-9a-f-]{36}$" },
      painted_rgba_png_base64: { type: "string", minLength: 4, maxLength: 34_952_536 } },
    required: ["link_attempt_id", "base_reference_handle", "painted_rgba_png_base64"] } };
  const rgba = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  const identity = { link_attempt_id: other.link_attempt_id,
    base_reference_handle: "ideogram_image_00000000-0000-4000-8000-000000000001" };
  const described = describeRemoteMediaFileTool(source);
  assert.deepEqual(described._meta?.["openai/fileParams"], ["file"]);
  const validate = new AjvJsonSchemaValidator().getValidator(described.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
  assert.equal(validate({ ...identity, file: file() }).valid, true);
  assert.equal(validate({ ...identity, painted_rgba_png_base64: rgba.toString("base64") }).valid, true);
  assert.equal(validate({ ...identity, file: file(), painted_rgba_png_base64: rgba.toString("base64") }).valid, false);
  const f = fixture(rgba);
  const prepared = await resolveRemoteMediaFileArguments(source, { ...identity, file: file() }, { ports: f.ports });
  assert.deepEqual(prepared.arguments, { ...identity, painted_rgba_png_base64: rgba.toString("base64") });
  assert.equal(Object.hasOwn(prepared.arguments, "filename"), false); assert.equal(Object.hasOwn(prepared.arguments, "mime_type"), false);
  prepared.dispose(); assert.deepEqual(prepared.arguments, identity);
  const invalid = fixture(MP4);
  await rejected(resolveRemoteMediaFileArguments(source, { ...identity, file: file() }, { ports: invalid.ports }), "FILE_TYPE_MISMATCH");
  const dual = fixture(rgba);
  await rejected(resolveRemoteMediaFileArguments(source, { ...identity, file: file(), painted_rgba_png_base64: rgba.toString("base64") },
    { ports: dual.ports }), "INVALID_FILE_INPUT"); assert.equal(dual.counts.dns, 0);
});

test("foreign hosts, credentials, ports, fragments and malformed file metadata are rejected before DNS", async () => {
  const f = fixture();
  for (const url of ["https://civitai.com/path", "http://files.oaiusercontent.com/x", "https://files.oaiusercontent.com.attacker.invalid/x",
    "https://127.0.0.1/x", "https://user:pass@files.oaiusercontent.com/x", "https://files.oaiusercontent.com:443/x", "https://files.oaiusercontent.com/x#fragment"]) {
    await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: { ...file(), download_url: url } }, { ports: f.ports }), "UNSUPPORTED_FILE_HOST");
  }
  for (const bad of [{ ...file(), another: true }, { ...file(), file_id: "" }, { ...file(), file_name: "../secret.png" },
    { ...file(), file_name: "C:\\secret.png" }, { ...file(), file_name: "CON.png" }, { ...file(), mime_type: "image/png\r\nX:secret" }]) {
    await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: bad }, { ports: f.ports }), "INVALID_FILE_INPUT");
  }
  assert.deepEqual(f.counts, { dns: 0, request: 0, cancel: 0 });
});

test("all DNS answers must be public and the TLS peer must equal the pinned address", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    const f = fixture();
    await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { ports: { ...f.ports,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }] } }), "UNSAFE_FILE_ADDRESS");
    assert.equal(f.counts.request, 0);
  }
  for (const change of [{ tlsAuthorized: false }, { remoteAddress: "8.8.8.8" }]) {
    const f = fixture(PNG, change);
    await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { ports: f.ports }), "UNSAFE_FILE_ADDRESS");
    assert.equal(f.counts.cancel, 1);
  }
});

test("redirects, compressed responses, oversized declared lengths and mismatched lengths fail without following a URL", async () => {
  for (const [change, code] of [
    [{ statusCode: 302, headers: { location: "http://127.0.0.1/private" } }, "FILE_DOWNLOAD_FAILED"],
    [{ headers: { "content-encoding": "gzip" } }, "INVALID_FILE_INPUT"],
    [{ headers: { "content-length": "999999999" } }, "FILE_LIMIT_EXCEEDED"],
    [{ headers: { "content-length": "1" } }, "FILE_DOWNLOAD_FAILED"]
  ] as const) {
    const f = fixture(PNG, change);
    await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { ports: f.ports }), code);
    assert.equal(f.counts.request, 1); assert.equal(f.counts.cancel, 1);
  }
});

test("stream and encoded bounds follow the canonical schema even without Content-Length and never exceed the 100MiB gateway ceiling", async () => {
  const f = fixture(PNG, { headers: {} });
  await rejected(resolveRemoteMediaFileArguments(tool(undefined, "image/png", 4), { ...other, file: file() }, { ports: f.ports }), "FILE_LIMIT_EXCEEDED");
  assert.equal(f.raw.every(byte => byte === 0), true);
  const large = fixture(PNG, { headers: { "content-length": String(100 * 1024 * 1024 + 1) } });
  await rejected(resolveRemoteMediaFileArguments(tool(undefined, "image/png", 1_000_000_000), { ...other, file: file() }, { ports: large.ports }), "FILE_LIMIT_EXCEEDED");
});

test("byte signatures, child MIME enums, declared/header MIME and filename extensions must agree", async () => {
  for (const [bytes, attachment, childMime, header] of [
    [PNG, { ...file(), mime_type: "video/mp4" }, "image/png", "image/png"],
    [PNG, file(), "video/mp4", "image/png"], [PNG, { ...file(), file_name: "looks-like.mp4" }, "image/png", "image/png"],
    [PNG, file(), "image/png", "video/mp4"], [Buffer.from("unknown bytes"), file(), "image/png", "application/octet-stream"],
    [MP4, file(), "video/mp4", "audio/mp4"]
  ] as const) {
    const f = fixture(bytes, { headers: { "content-type": header } });
    await rejected(resolveRemoteMediaFileArguments(tool(undefined, childMime), { ...other, file: attachment }, { ports: f.ports }), "FILE_TYPE_MISMATCH");
    assert.equal(f.raw.every(byte => byte === 0), true);
  }
});

test("abort and DNS/body timeout are bounded and expose only fixed safe codes", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture();
  await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { ports: f.ports, signal: controller.signal }), "FILE_REQUEST_ABORTED");
  assert.equal(f.counts.dns, 0);
  await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { timeoutMs: 5,
    ports: { dnsLookup: async () => await new Promise(() => {}) } }), "FILE_REQUEST_TIMEOUT");
  const stalled = fixture(PNG, { headers: {}, body: { [Symbol.asyncIterator]() { return { async next() { return await new Promise(() => {}); } }; } } });
  await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, file: file() }, { ports: stalled.ports, timeoutMs: 5 }), "FILE_REQUEST_TIMEOUT");
  assert.equal(stalled.counts.cancel, 1);
});

test("accessors and unknown strict top-level fields are rejected without side effects", async () => {
  const f = fixture(); let getterCalls = 0;
  const input = { ...other, get file() { getterCalls++; return file(); } };
  await rejected(resolveRemoteMediaFileArguments(tool(), input, { ports: f.ports }), "INVALID_FILE_INPUT");
  await rejected(resolveRemoteMediaFileArguments(tool(), { ...other, extra: true, file: file() }, { ports: f.ports }), "INVALID_FILE_INPUT");
  assert.equal(getterCalls, 0); assert.equal(f.counts.dns, 0);
});

test("Topaz Enhance fixed MP4 file input preserves its exact two-field byte contract without injecting MIME", async () => {
  const source: Tool = { name: "syntx_owner_upload_topaz_enhance_original", inputSchema: { type: "object", additionalProperties: false,
    properties: { link_attempt_id: { type: "string" }, filename: { type: "string", minLength: 1, maxLength: 255, pattern: "\\.mp4$" },
      content_base64: { type: "string", minLength: 4, maxLength: 69_905_068 } }, required: ["link_attempt_id", "filename", "content_base64"] } };
  const identity = { link_attempt_id: other.link_attempt_id }, described = describeRemoteMediaFileTool(source);
  assert.deepEqual(described._meta?.["openai/fileParams"], ["file"]);
  const validate = new AjvJsonSchemaValidator().getValidator(described.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
  assert.equal(validate({ ...identity, file: file() }).valid, true);
  assert.equal(validate({ ...identity, filename: "source.mp4", content_base64: MP4.toString("base64") }).valid, true);
  assert.equal(validate({ ...identity, file: file(), filename: "source.mp4" }).valid, false);
  const f = fixture(MP4), resolved = await resolveRemoteMediaFileArguments(source, { ...identity, file: file() }, { ports: f.ports });
  assert.deepEqual(resolved.arguments, { ...identity, filename: "attachment.mp4", content_base64: MP4.toString("base64") });
  assert.equal(Object.hasOwn(resolved.arguments, "mime_type"), false); resolved.dispose();
  const wrong = fixture(PNG);
  await rejected(resolveRemoteMediaFileArguments(source, { ...identity, file: file() }, { ports: wrong.ports }), "FILE_TYPE_MISMATCH");
  const dual = fixture(MP4);
  await rejected(resolveRemoteMediaFileArguments(source, { ...identity, file: file(), filename: "source.mp4" }, { ports: dual.ports }), "INVALID_FILE_INPUT");
  assert.equal(dual.counts.dns, 0);
});

test("current Switchx reference file facade preserves exact style and mask roles for the unchanged child validators", async () => {
  const source = tool("syntx_owner_upload_switchx_reference");
  delete source.inputSchema.properties!.model_id;
  source.inputSchema.properties!.role = { type: "string", enum: ["style_image", "image_mask", "video_mask"] };
  source.inputSchema.properties!.mime_type = { type: "string", enum: ["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/quicktime"] };
  source.inputSchema.properties!.content_base64 = { type: "string", minLength: 1, maxLength: 139_810_136 };
  source.inputSchema.required = ["link_attempt_id", "role", "filename", "mime_type", "content_base64"];
  const described = describeRemoteMediaFileTool(source);
  assert.deepEqual(described._meta?.["openai/fileParams"], ["file"]);
  const validate = new AjvJsonSchemaValidator().getValidator(described.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
  for (const role of ["style_image", "image_mask", "video_mask"]) {
    const args = { link_attempt_id: other.link_attempt_id, role, file: file() }, bytes = role === "video_mask" ? MP4 : PNG;
    assert.equal(validate(args).valid, true);
    const f = fixture(bytes), resolved = await resolveRemoteMediaFileArguments(source, args, { ports: f.ports });
    try { assert.equal(resolved.arguments.role, role); assert.equal(resolved.arguments.content_base64, bytes.toString("base64"));
      assert.equal(Object.hasOwn(resolved.arguments, "file"), false); }
    finally { resolved.dispose(); }
  }
  assert.equal(validate({ link_attempt_id: other.link_attempt_id, role: "background", file: file() }).valid, false);
});

test("current common video upload facade preserves model and selected trim while deriving current image and document containers", async () => {
  const source = tool("syntx_owner_upload_current_video_reference");
  delete source.inputSchema.properties!.role;
  source.inputSchema.properties!.model_id = { type: "string", enum: ["seedance-2.0", "wan_30_omni"] };
  source.inputSchema.properties!.mime_type = { type: "string", enum: ["image/bmp", "image/tiff", "video/mp4", "application/pdf", "text/plain", "text/markdown",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] };
  source.inputSchema.properties!.trim = { type: "object", additionalProperties: false, properties: { start_seconds: { type: "number", minimum: 0 },
    end_seconds: { type: "number", exclusiveMinimum: 0 } }, required: ["start_seconds", "end_seconds"] };
  source.inputSchema.required = ["link_attempt_id", "model_id", "filename", "mime_type", "content_base64"];
  const described = describeRemoteMediaFileTool(source);
  assert.deepEqual(described._meta?.["openai/fileParams"], ["file"]);
  assert.equal(described.inputSchema.properties!.trim, source.inputSchema.properties!.trim);
  const trim = { start_seconds: 2, end_seconds: 7 }, vf = fixture(MP4);
  const prepared = await resolveRemoteMediaFileArguments(source, { link_attempt_id: other.link_attempt_id, model_id: "seedance-2.0", trim, file: file() }, { ports: vf.ports });
  assert.equal(prepared.arguments.trim, trim); assert.equal(prepared.arguments.model_id, "seedance-2.0"); prepared.dispose();
  for (const [bytes, mime, filename] of [[Buffer.from("BMheader synthetic", "latin1"), "image/bmp", "frame.bmp"],
    [Buffer.from("49492a0008000000", "hex"), "image/tiff", "frame.tiff"], [PDF, "application/pdf", "reference.pdf"],
    [Buffer.from("A UTF-8 source document — проверка"), "text/plain", "source.txt"],
    [Buffer.from("# Source\n- reference"), "text/markdown", "source.md"],
    [Buffer.from("d0cf11e0a1b11ae1", "hex"), "application/msword", "source.doc"],
    [Buffer.from("PK\x03\x04[Content_Types].xmlword/document.xml", "latin1"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "source.docx"],
    [Buffer.from("PK\x03\x04[Content_Types].xmlxl/workbook.xml", "latin1"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "source.xlsx"]] as const) {
    const f = fixture(bytes), attachment = { ...file(), mime_type: mime, file_name: filename };
    const result = await resolveRemoteMediaFileArguments(source, { link_attempt_id: other.link_attempt_id, model_id: "wan_30_omni", file: attachment }, { ports: f.ports });
    try { assert.equal(result.arguments.mime_type, mime); assert.equal(result.arguments.filename, filename); assert.equal(result.arguments.content_base64, bytes.toString("base64")); }
    finally { result.dispose(); }
  }
  const ambiguous = fixture(Buffer.from("PK\x03\x04unknown archive", "latin1"));
  await rejected(resolveRemoteMediaFileArguments(source, { link_attempt_id: other.link_attempt_id, model_id: "wan_30_omni", file: file() }, { ports: ambiguous.ports }), "FILE_TYPE_MISMATCH");
});
