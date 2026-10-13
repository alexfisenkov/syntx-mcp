import { z } from "zod/v4";

const MAX_URL_LENGTH = 4096;
const MAX_FILES = 16;
const MAX_FILE_ID_LENGTH = 256;
const SAFE_FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/**
 * Internal-only upload reference. The URL is deliberately kept in this
 * module's typed boundary for a future upload -> generation composer; it is
 * never an MCP result and is not exported from the package entrypoint.
 */
export interface InternalUploadReference {
  readonly file_id?: string;
  readonly url: string;
}

const providerId = z.union([
  z.string().max(MAX_FILE_ID_LENGTH),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
]);

const uploadFileEntry = z.object({
  id: providerId.optional(),
  file_id: providerId.optional(),
  url: z.string().min(1).max(MAX_URL_LENGTH)
}).strip();

const uploadReferenceResponse = z.object({
  files: z.array(uploadFileEntry).min(1).max(MAX_FILES)
}).strip();

/**
 * Parse the frontend's `{files:[{url,...}]}` upload response into an
 * internal reference bridge. Every file must have a URL and that URL must be
 * an HTTPS object on the observed SYNTX storage host. No fallback to a
 * filename, numeric id, or another field is allowed.
 */
export function parseInternalUploadReferences(raw: unknown): InternalUploadReference[] {
  const parsed = uploadReferenceResponse.safeParse(raw);
  if (!parsed.success) throw new Error("UPLOAD_REFERENCE_PROTOCOL_ERROR");

  return parsed.data.files.map((file) => {
    if (!isSafeUploadReferenceUrl(file.url)) {
      throw new Error("UPLOAD_REFERENCE_URL_NOT_ALLOWLISTED");
    }
    const id = file.file_id ?? file.id;
    if (id === undefined) return { url: file.url };
    const fileId = String(id);
    if (!SAFE_FILE_ID.test(fileId)) throw new Error("UPLOAD_REFERENCE_PROTOCOL_ERROR");
    return { file_id: fileId, url: file.url };
  });
}

/** Internal URL validation; callers must not serialize the returned URL. */
export function isSafeUploadReferenceUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "r2.syntx.ai" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
}
