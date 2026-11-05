export const OWNER_STDIO_DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
export const OWNER_STDIO_MAX_BUFFER_BYTES = 192 * 1024 * 1024;

/** Trusted launch environment only; no value is read from an MCP tool argument. */
export function readOwnerStdioMaxBufferBytes(value: string | undefined): number {
  if (value === undefined) return OWNER_STDIO_DEFAULT_MAX_BUFFER_BYTES;
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) throw new Error("OWNER_STDIO_MAX_BUFFER_BYTES_INVALID");
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < OWNER_STDIO_DEFAULT_MAX_BUFFER_BYTES || bytes > OWNER_STDIO_MAX_BUFFER_BYTES) {
    throw new Error("OWNER_STDIO_MAX_BUFFER_BYTES_INVALID");
  }
  return bytes;
}
