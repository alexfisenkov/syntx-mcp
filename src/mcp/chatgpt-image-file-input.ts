import { types } from "node:util";
import { z } from "zod/v4";
import {
  resolveChatgptImageFile,
  type ChatgptImageFileMetadata,
  type ResolvedChatgptImageFile
} from "../application/chatgpt-image-file-resolver.js";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"] as const;
const chatgptFileInputSchema = z.object({
  download_url: z.string().min(1).max(16_384),
  file_id: z.string().min(1).max(512),
  mime_type: z.string().max(128).optional(),
  file_name: z.string().min(1).max(255).optional()
}).strict();

export type ChatgptImageFileResolver = (
  file: ChatgptImageFileMetadata,
  maxBytes: number,
  signal?: AbortSignal
) => Promise<ResolvedChatgptImageFile>;

export const CHATGPT_IMAGE_FILE_SCHEMA = chatgptFileInputSchema;
export const CHATGPT_IMAGE_FILE_TOOL_META = Object.freeze({
  "openai/fileParams": Object.freeze(["file"])
});

/** Resolve only the host-injected file object; no caller-supplied URL is fetched as a separate argument. */
export async function resolveChatgptImageUploadInput(
  fileInput: unknown,
  variant: string,
  signal?: AbortSignal,
  resolver: ChatgptImageFileResolver = resolveChatgptImageFile
): Promise<{ readonly content_base64: string; readonly filename: string; readonly mime_type: string }> {
  const parsed = chatgptFileInputSchema.parse(fileInput);
  const file: ChatgptImageFileMetadata = { download_url: parsed.download_url, file_id: parsed.file_id,
    ...(parsed.mime_type === undefined ? {} : { mime_type: parsed.mime_type }),
    ...(parsed.file_name === undefined ? {} : { file_name: parsed.file_name }) };
  const maxBytes = variant === "banana-2.1" ? 7 * 1024 * 1024 : 32 * 1024 * 1024;
  let resolved: ResolvedChatgptImageFile | undefined;
  let bytes: Uint8Array | undefined;
  try {
    resolved = await resolver(file, maxBytes, signal);
    if (!resolved || typeof resolved !== "object" || types.isProxy(resolved)) throw new Error("invalid");
    const descriptors = Object.getOwnPropertyDescriptors(resolved);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !["bytes", "filename", "mime_type"].every((key) => Object.hasOwn(descriptors, key) && "value" in descriptors[key]!)) {
      throw new Error("invalid");
    }
    if (types.isProxy(resolved.bytes) || !(resolved.bytes instanceof Uint8Array) ||
        (Object.getPrototypeOf(resolved.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(resolved.bytes) !== Buffer.prototype) ||
        resolved.bytes.byteLength < 1 || resolved.bytes.byteLength > maxBytes ||
        typeof resolved.filename !== "string" || Buffer.byteLength(resolved.filename, "utf8") > 255 ||
        typeof resolved.mime_type !== "string" || !(IMAGE_MIME_TYPES as readonly string[]).includes(resolved.mime_type)) throw new Error("invalid");
    bytes = new Uint8Array(resolved.bytes);
    return Object.freeze({ content_base64: Buffer.from(bytes).toString("base64"), filename: resolved.filename, mime_type: resolved.mime_type });
  } finally {
    bytes?.fill(0);
    if (resolved?.bytes instanceof Uint8Array && !types.isProxy(resolved.bytes)) resolved.bytes.fill(0);
  }
}

export function isSafeChatgptFileInput(value: unknown): boolean {
  return chatgptFileInputSchema.safeParse(value).success;
}
