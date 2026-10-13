// Error class + safe-error-code mapping for the source-backed-result CLI.
// Used by every other file in this directory and by the main script; itself
// depends on nothing else here.

export class SourceBackedResultCliError extends Error {
  constructor(code) {
    super("SYNTX source-backed result CLI request was rejected.");
    this.name = "SourceBackedResultCliError";
    this.code = code;
  }
}

const SAFE_RESULT_CODES = new Set([
  "SOURCE_BACKED_RESULT_DRIFT_DETECTED",
  "SOURCE_BACKED_RESULT_INVALID",
  "SOURCE_RELATIONSHIP_INVALID",
  "SOURCE_VALIDATION_FAILED",
  "IMPLEMENTATION_RELATIONSHIP_INVALID",
]);
const SAFE_TOOLCHAIN_CODES = new Set([
  "SOURCE_BACKED_TOOLCHAIN_INVALID",
  "SOURCE_BACKED_TOOLCHAIN_READ_FAILED",
]);
const SAFE_IMMUTABLE_CODES = new Set([
  "IMMUTABLE_SNAPSHOT_REQUEST_INVALID",
  "IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE",
  "IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION",
  "IMMUTABLE_SNAPSHOT_TARGET_EXISTS",
  "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED",
  "IMMUTABLE_SNAPSHOT_WRITE_FAILED",
]);

export function hasErrorCode(error, expectedCode) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === expectedCode
  );
}

export function safeErrorCode(error) {
  if (error instanceof SourceBackedResultCliError) return error.code;
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    if (SAFE_RESULT_CODES.has(error.code)) return error.code;
    if (SAFE_TOOLCHAIN_CODES.has(error.code)) return error.code;
    if (SAFE_IMMUTABLE_CODES.has(error.code)) return error.code;
    if (
      error.name === "SettingsSourceInventoryError" ||
      error.name === "StaticSettingsCompilerError" ||
      error.name === "BananaParserCanaryCompilerError"
    ) {
      return "PINNED_SOURCE_VERIFICATION_FAILED";
    }
  }
  return "UNEXPECTED_ERROR";
}
