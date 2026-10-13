/**
 * Shared across every MCP tool that maps a SyntxHttpError code to a
 * human-readable message. Each tool spreads this and adds its own
 * INVALID_REQUEST wording plus any tool-specific codes — kept in one place
 * so a wording fix cannot silently drift between tools.
 */
export const SYNTX_HTTP_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  AUTH_REQUIRED: "A linked SYNTX account is required.",
  AUTH_OR_ACCESS_DENIED: "The linked SYNTX account did not authorize this request.",
  UPSTREAM_RATE_LIMITED: "SYNTX temporarily rate-limited this request.",
  UPSTREAM_UNAVAILABLE: "SYNTX is temporarily unavailable.",
  UPSTREAM_TIMEOUT: "The SYNTX request timed out.",
  UPSTREAM_REQUEST_ABORTED: "The SYNTX request was canceled by the client.",
  UPSTREAM_PROTOCOL_ERROR: "SYNTX returned an unsupported response.",
  INTERNAL_ERROR: "The operation failed without exposing internal details."
});
