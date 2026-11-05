import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { types } from "node:util";
import {
  CivitaiPinnedHttpsDownloadTransport,
  CivitaiPinnedHttpsDownloadTransportError,
  type CivitaiPinnedHttpsDownloadTransportPorts,
  type CivitaiPinnedHttpsDownloadResponse
} from "../adapter/civitai/pinned-https-download-transport.js";

const HOST = "files.oaiusercontent.com";
const BYTE_FIELDS = ["content_base64", "filename", "mime_type"] as const;
const MAX_BYTES = 100 * 1024 * 1024;
// Exact canonical byte-intake names, additionally gated by their actual child schema.
const UPLOAD_NAMES = new Set(`
syntx_owner_generate_switchx_video
syntx_owner_import_heygen4_asset syntx_owner_import_higgsfield_dop_image
syntx_owner_upload_acttwo_character_image syntx_owner_upload_acttwo_performance_video
syntx_owner_upload_current_video_reference
syntx_owner_upload_elevenlabs_sts_original syntx_owner_upload_flux3_video_reference
syntx_owner_upload_grok_i2v_image syntx_owner_upload_grok_v2v_reference
syntx_owner_upload_hailuo02_i2v_image syntx_owner_upload_hailuo_initial_image
syntx_owner_upload_happy_horse_edit_video syntx_owner_upload_happy_horse_image
syntx_owner_upload_higgsfield_dop_image syntx_owner_upload_kling4_reference
syntx_owner_upload_kling_i2v_image syntx_owner_upload_kling_keyframes_image
syntx_owner_upload_kling_media_reference syntx_owner_upload_kling_motion_control_image
syntx_owner_upload_kling_motion_control_video syntx_owner_upload_runway_i2v_image
syntx_owner_upload_seedance_editor_frame syntx_owner_upload_seedance_editor_video
syntx_owner_upload_suno_audio_reference syntx_owner_upload_topaz_astra_original
syntx_owner_upload_switchx_reference
syntx_owner_upload_current_video_reference
syntx_owner_upload_topaz_enhance_original syntx_owner_upload_veo_omni_reference
syntx_owner_upload_wan25_i2v_preview_image syntx_owner_upload_wan26_i2v_audio
syntx_owner_upload_wan26_i2v_image syntx_owner_upload_wan26_r2v_image
syntx_owner_upload_wan26_r2v_selected_video syntx_owner_upload_wan27_i2v_image
syntx_owner_upload_wan27_r2v_image syntx_owner_upload_wan27_r2v_video
syntx_owner_upload_wan27_videoedit_reference syntx_owner_upload_wan30_edit_video
syntx_owner_upload_wan30_first_last_frame syntx_owner_upload_wan30_omni_image
syntx_owner_upload_wan30_reference_image syntx_upload_banana_inpaint_auxiliary_reference
syntx_owner_upload_wan_t2v_audio
syntx_upload_banana_inpaint_original syntx_upload_banana_inpaint_painted_composite
syntx_upload_clarity_upscale_image syntx_upload_file syntx_upload_flux_image_reference
syntx_upload_grok_image_reference syntx_upload_grok_t2i_image_reference
syntx_upload_ideogram_image_reference syntx_upload_ideogram_mask syntx_upload_image_reference
syntx_upload_kontext_reference_image syntx_upload_magnific_upscale_image
syntx_upload_runway_image_reference syntx_upload_seedream_editor_drawing
syntx_upload_seedream_editor_original syntx_upload_seedream_image_reference
syntx_upload_standard_image_reference syntx_upload_uni_image_reference syntx_upload_video2audio_original syntx_upload_wan_reference_image
`.trim().split(/\s+/u));

type Schema = Record<string, unknown>;
interface ByteInputRule {
  readonly byteField: string;
  readonly inputFields: readonly string[];
  readonly schema: Schema;
  readonly fixedMime?: "image/png" | "video/mp4";
}
export type RemoteOwnerMediaFileInputErrorCode = "INVALID_FILE_INPUT" | "UNSUPPORTED_FILE_HOST" |
  "UNSAFE_FILE_ADDRESS" | "FILE_DOWNLOAD_FAILED" | "FILE_LIMIT_EXCEEDED" |
  "FILE_TYPE_MISMATCH" | "FILE_REQUEST_ABORTED" | "FILE_REQUEST_TIMEOUT";
export class RemoteOwnerMediaFileInputError extends Error {
  constructor(readonly code: RemoteOwnerMediaFileInputErrorCode) {
    super("The remote media attachment could not be prepared safely.");
    this.name = "RemoteOwnerMediaFileInputError";
  }
}
export interface RemoteOwnerMediaFileInputOptions {
  readonly ports?: CivitaiPinnedHttpsDownloadTransportPorts;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface ResolvedRemoteMediaFileArguments {
  readonly arguments: Record<string, unknown>;
  /** Drop the temporary immutable Base64 string reference after the one child call. */
  dispose(): void;
}

/** Gateway-only descriptor; canonical child schemas and already-native file tools stay unchanged. */
export function describeRemoteMediaFileTool(tool: Tool): Tool {
  const rule = uploadRule(tool);
  if (!rule) return tool;
  const file = { type: "object", additionalProperties: false,
      properties: { download_url: { type: "string", minLength: 1, maxLength: 16_384 },
        file_id: { type: "string", minLength: 1, maxLength: 512 },
        mime_type: { type: "string", minLength: 1, maxLength: 128 },
        file_name: { type: "string", minLength: 1, maxLength: 255 } }, required: ["download_url", "file_id"] };
  const input = projectFileInputBranches(tool.inputSchema, file, rule.inputFields) as Tool["inputSchema"];
  return { ...tool, inputSchema: { ...input,
    allOf: [...(Array.isArray(input.allOf) ? input.allOf : []), { oneOf: [
      { required: ["file"], not: { anyOf: rule.inputFields.map(key => ({ required: [key] })) } },
      { required: [...rule.inputFields], not: { required: ["file"] } }
    ] }]
  }, _meta: { ...tool._meta, "openai/fileParams": ["file"] } };
}

// Root logical variants may themselves require the byte triple or forbid
// unknown properties. Project only those root branches; nested argument schemas
// retain their exact model-specific bounds and requirements.
function projectFileInputBranches(schema: Schema, file: Schema, byteFields: readonly string[]): Schema {
  const projected: Schema = { ...schema };
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    projected.properties = { ...schema.properties, file };
  }
  if (Array.isArray(schema.required)) projected.required = schema.required.filter(key => !(byteFields as readonly unknown[]).includes(key));
  for (const key of ["oneOf", "anyOf", "allOf"]) if (Array.isArray(schema[key])) {
    projected[key] = schema[key].map(branch => branch && typeof branch === "object" && !Array.isArray(branch)
      ? projectFileInputBranches(branch as Schema, file, byteFields) : branch);
  }
  return projected;
}

/** Resolve only an advertised facade, then delegate unchanged business validation to the child. */
export async function resolveRemoteMediaFileArguments(tool: Tool, args: Record<string, unknown>,
  options: RemoteOwnerMediaFileInputOptions = {}): Promise<ResolvedRemoteMediaFileArguments> {
  const fields = dataRecord(args);
  const rule = uploadRule(tool, true);
  if (!rule) return { arguments: fields, dispose() {} };
  const schema = rule.schema;
  const hasFile = Object.hasOwn(fields, "file");
  if (!hasFile) {
    if (rule.inputFields.some(key => !Object.hasOwn(fields, key))) fail("INVALID_FILE_INPUT");
    return { arguments: fields, dispose() {} };
  }
  if (rule.inputFields.some(key => Object.hasOwn(fields, key))) fail("INVALID_FILE_INPUT");
  const properties = tool.inputSchema.properties ?? {};
  if (tool.inputSchema.additionalProperties === false && Object.keys(fields).some(key => key !== "file" && !Object.hasOwn(properties, key))) fail("INVALID_FILE_INPUT");
  if ((tool.inputSchema.required ?? []).some(key => !rule.inputFields.includes(key) && !Object.hasOwn(fields, key))) fail("INVALID_FILE_INPUT");
  const metadata = dataRecord(fields.file);
  if (Object.keys(metadata).some(key => !["download_url", "file_id", "mime_type", "file_name"].includes(key)) ||
      typeof metadata.download_url !== "string" || metadata.download_url.length < 1 || metadata.download_url.length > 16_384 ||
      typeof metadata.file_id !== "string" || metadata.file_id.length < 1 || metadata.file_id.length > 512 ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(metadata.file_id)) fail("INVALID_FILE_INPUT");
  if (metadata.mime_type !== undefined && (typeof metadata.mime_type !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(metadata.mime_type) || metadata.mime_type.length > 128)) fail("INVALID_FILE_INPUT");
  if (metadata.file_name !== undefined) safeFilename(metadata.file_name);
  const url = approvedUrl(metadata.download_url);
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 ||
      (options.signal !== undefined && (!(options.signal instanceof AbortSignal) || types.isProxy(options.signal)))) fail("INVALID_FILE_INPUT");
  const maxChars = schema.maxLength as number;
  const maxBytes = Math.min(MAX_BYTES, Math.floor(maxChars / 4) * 3);
  const transport = new CivitaiPinnedHttpsDownloadTransport({
    // The reusable transport requires its own first-party origin. The facade's
    // exact-host gate above makes that origin unreachable and supplies no auth.
    approvedOrigins: ["https://civitai.com", `https://${HOST}`], requestTimeoutMs: timeout,
    ...(options.ports === undefined ? {} : { ports: options.ports }) });
  let response: CivitaiPinnedHttpsDownloadResponse | undefined;
  const chunks: Buffer[] = [];
  let bytes: Buffer | undefined;
  try {
    response = await transport.open({ url, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (response.status !== 200) fail("FILE_DOWNLOAD_FAILED");
    const encoding = response.headers["content-encoding"];
    if (encoding !== undefined && encoding.toLowerCase() !== "identity") fail("INVALID_FILE_INPUT");
    const length = response.headers["content-length"];
    if (length !== undefined && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) < 1 || Number(length) > maxBytes)) fail("FILE_LIMIT_EXCEEDED");
    let total = 0;
    for await (const chunk of response.body) {
      try {
        total += chunk.byteLength;
        if (total > maxBytes) fail("FILE_LIMIT_EXCEEDED");
        chunks.push(Buffer.from(chunk));
      } finally { chunk.fill(0); }
    }
    if (total < 1 || (length !== undefined && total !== Number(length))) fail("FILE_DOWNLOAD_FAILED");
    bytes = Buffer.concat(chunks, total);
    const mime = chooseMime(bytes, rule.fixedMime ? { type: "string", const: rule.fixedMime } : properties.mime_type as Schema, metadata.mime_type as string | undefined,
      response.headers["content-type"], metadata.file_name as string | undefined);
    const filename = metadata.file_name ?? `attachment.${EXTENSIONS[mime]![0]}`;
    safeFilename(filename);
    const extension = (filename as string).split(".").pop()!.toLowerCase();
    if (!EXTENSIONS[mime]?.includes(extension)) fail("FILE_TYPE_MISMATCH");
    const canonical: Record<string, unknown> = { ...fields,
      ...(rule.inputFields.includes("filename") ? { filename } : {}),
      ...(rule.inputFields.includes("mime_type") ? { mime_type: mime } : {}) };
    delete canonical.file;
    const encoded = bytes.toString("base64");
    if (encoded.length > maxChars || encoded.length < Number(schema.minLength ?? 0)) fail("FILE_LIMIT_EXCEEDED");
    canonical[rule.byteField] = encoded;
    return { arguments: canonical, dispose() { delete canonical[rule.byteField]; } };
  } catch (error) {
    if (error instanceof RemoteOwnerMediaFileInputError) throw error;
    if (error instanceof CivitaiPinnedHttpsDownloadTransportError) {
      if (error.code === "REQUEST_ABORTED") fail("FILE_REQUEST_ABORTED");
      if (error.code === "REQUEST_TIMEOUT") fail("FILE_REQUEST_TIMEOUT");
      if (["DNS_ADDRESS_REJECTED", "TLS_REJECTED", "PEER_ADDRESS_MISMATCH"].includes(error.code)) fail("UNSAFE_FILE_ADDRESS");
    }
    fail("FILE_DOWNLOAD_FAILED");
  } finally {
    bytes?.fill(0); for (const chunk of chunks) chunk.fill(0);
    await response?.cancel().catch(() => undefined);
  }
  return fail("FILE_DOWNLOAD_FAILED");
}

function uploadRule(tool: Tool, resolveNativeStandard = false): ByteInputRule | undefined {
  const input = tool.inputSchema, props = input.properties;
  const nativeStandard = resolveNativeStandard && tool.name === "syntx_upload_standard_image_reference";
  if (!props || (Object.hasOwn(props, "file") && !nativeStandard)) return undefined;
  if (tool.name === "syntx_upload_ideogram_mask") {
    const byteField = "painted_rgba_png_base64", schema = props[byteField] as Schema | undefined;
    return schema?.type === "string" && Number.isSafeInteger(schema.maxLength) && (schema.maxLength as number) >= 4 &&
      input.required?.includes(byteField) ? { byteField, inputFields: [byteField], schema, fixedMime: "image/png" } : undefined;
  }
  if (tool.name === "syntx_owner_upload_topaz_enhance_original") {
    const schema = props.content_base64 as Schema | undefined;
    return schema?.type === "string" && Number.isSafeInteger(schema.maxLength) && (schema.maxLength as number) >= 4 &&
      (props.filename as Schema | undefined)?.type === "string" &&
      ["content_base64", "filename"].every(key => input.required?.includes(key)) && !Object.hasOwn(props, "mime_type")
      ? { byteField: "content_base64", inputFields: ["content_base64", "filename"], schema, fixedMime: "video/mp4" } : undefined;
  }
  if (!UPLOAD_NAMES.has(tool.name) ||
      BYTE_FIELDS.some(key => !props[key] || (!nativeStandard && !(input.required ?? []).includes(key)))) return undefined;
  const base64 = props.content_base64 as Schema;
  if (base64.type !== "string" || !Number.isSafeInteger(base64.maxLength) || (base64.maxLength as number) < 4 ||
      (props.filename as Schema).type !== "string") return undefined;
  return { byteField: "content_base64", inputFields: BYTE_FIELDS, schema: base64 };
}
function approvedUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail("INVALID_FILE_INPUT"); }
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || /^https:\/\/([^/?#]*)/iu.exec(value)?.[1]?.toLowerCase() !== HOST ||
      url.protocol !== "https:" || url.hostname !== HOST || url.port || url.username || url.password || url.hash) fail("UNSUPPORTED_FILE_HOST");
  return url;
}
function safeFilename(value: unknown): void {
  if (typeof value !== "string" || value.length < 1 || Buffer.byteLength(value, "utf8") > 255 ||
      /[\/\\:*?"<>|\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || /[. ]$/u.test(value) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(value)) fail("INVALID_FILE_INPUT");
}
function dataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_FILE_INPUT");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(descriptors).some(key =>
    typeof key !== "string" || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_FILE_INPUT");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["jpg", "jpeg"], "image/jpg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
  "image/avif": ["avif"], "image/heic": ["heic"], "image/heif": ["heif"], "image/gif": ["gif"],
  "image/bmp": ["bmp"], "image/tiff": ["tif", "tiff"],
  "video/mp4": ["mp4"], "video/quicktime": ["mov"], "video/mov": ["mov"], "video/webm": ["webm"],
  "video/3gpp": ["3gp", "3gpp"], "video/x-flv": ["flv"], "video/x-ms-wmv": ["wmv"],
  "video/mpeg": ["mpeg", "mpg"], "audio/mpeg": ["mp3"], "audio/mp3": ["mp3"], "audio/wav": ["wav"], "audio/x-wav": ["wav"],
  "audio/mp4": ["m4a", "mp4"], "audio/aac": ["aac"], "audio/flac": ["flac"], "audio/ogg": ["ogg", "opus"],
  "audio/webm": ["webm"], "application/pdf": ["pdf"], "text/plain": ["txt", "md", "markdown"], "text/markdown": ["md", "markdown"],
  "application/msword": ["doc"], "application/vnd.ms-excel": ["xls"], "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"]
};
function chooseMime(bytes: Uint8Array, schema: Schema, declared: string | undefined, header: string | undefined, filename?: string): string {
  const sniffed = sniff(bytes);
  const allowed = mimeValues(schema) ?? Object.keys(EXTENSIONS);
  const candidates = allowed.filter((mime): mime is string => typeof mime === "string" && sniffed.includes(mime));
  const headerMime = header?.split(";", 1)[0]?.trim().toLowerCase();
  const concrete = [declared, headerMime].filter((mime): mime is string => mime !== undefined &&
    mime !== "application/octet-stream" && mime !== "binary/octet-stream");
  for (const mime of concrete) if (!sniffed.includes(mime) || !candidates.some(candidate => canonicalMime(candidate) === canonicalMime(mime))) fail("FILE_TYPE_MISMATCH");
  if (concrete.length === 2 && canonicalMime(concrete[0]!) !== canonicalMime(concrete[1]!)) fail("FILE_TYPE_MISMATCH");
  const extension = filename?.split(".").pop()?.toLowerCase();
  const named = extension === undefined ? undefined : candidates.find(mime => EXTENSIONS[mime]?.includes(extension));
  if (!declared && !concrete.length && !named && candidates.length > 1 && candidates.every(mime => mime.startsWith("application/"))) fail("FILE_TYPE_MISMATCH");
  const selected = [declared, headerMime, named, ...candidates].find(mime => mime !== undefined && candidates.includes(mime));
  if (!selected || !EXTENSIONS[selected]) fail("FILE_TYPE_MISMATCH");
  return selected;
}
function canonicalMime(mime: string): string {
  return ({ "image/jpg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "video/mov": "video/quicktime",
    "text/markdown": "text/plain" } as Record<string, string>)[mime] ?? mime;
}
function mimeValues(schema: Schema): readonly unknown[] | undefined {
  if (typeof schema.const === "string") return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum;
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return union.flatMap(item => item && typeof item === "object" ? mimeValues(item as Schema) ?? [] : []);
  return undefined;
}
function sniff(bytes: Uint8Array): readonly string[] {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(64, bytes.byteLength));
  const ascii = (start: number, length: number) => head.toString("latin1", start, start + length);
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ["image/png"];
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return ["image/jpeg", "image/jpg"];
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return ["image/webp"];
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return ["audio/wav", "audio/x-wav"];
  if (ascii(0, 5) === "%PDF-") return ["application/pdf"];
  if (ascii(0, 2) === "BM") return ["image/bmp"];
  if (head.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0])) || head.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0, 0x2a]))) return ["image/tiff"];
  // Container identity only. The exact child validator still owns document
  // admission; this facade neither extracts nor executes archive contents.
  if (head.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) return ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"];
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(65536, bytes.byteLength));
    const office = [["word/", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["xl/", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["ppt/", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]] as const;
    const identified = office.filter(([name]) => prefix.includes(name)).map(([, mime]) => mime);
    return identified.length === 1 ? identified : office.map(([, mime]) => mime);
  }
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return ["image/gif"];
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 56);
    if (/avif|avis/u.test(brand)) return ["image/avif"];
    if (/heic|heix|hevc|hevx/u.test(brand)) return ["image/heic", "image/heif"];
    if (/mif1|msf1/u.test(brand)) return ["image/heif"];
    if (/qt  /u.test(brand)) return ["video/quicktime", "video/mov"];
    if (/3gp/u.test(brand)) return ["video/3gpp"];
    if (/M4A /u.test(brand)) return ["audio/mp4"];
    return ["video/mp4", "audio/mp4"];
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return ["video/webm", "audio/webm"];
  if (ascii(0, 4) === "fLaC") return ["audio/flac"];
  if (ascii(0, 4) === "OggS") return ["audio/ogg"];
  if (ascii(0, 3) === "FLV") return ["video/x-flv"];
  if (head.length >= 16 && head.subarray(0, 16).equals(Buffer.from("3026b2758e66cf11a6d900aa0062ce6c", "hex"))) return ["video/x-ms-wmv"];
  if (head[0] === 255 && ((head[1] ?? 0) & 0xf6) === 0xf0) return ["audio/aac"];
  if (ascii(0, 3) === "ID3" || (head[0] === 255 && ((head[1] ?? 0) & 0xe0) === 0xe0 && ((head[1] ?? 0) & 0x06) !== 0)) return ["audio/mpeg", "audio/mp3"];
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && [0xba, 0xb3].includes(head[3] ?? -1)) return ["video/mpeg"];
  try {
    const prefix = bytes.subarray(0, Math.min(65536, bytes.length));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(prefix, { stream: prefix.length < bytes.length });
    if (text.length && !text.includes("\u0000")) return ["text/plain", "text/markdown"];
  } catch { /* unrecognized binary input */ }
  return fail("FILE_TYPE_MISMATCH");
}
function fail(code: RemoteOwnerMediaFileInputErrorCode): never { throw new RemoteOwnerMediaFileInputError(code); }
