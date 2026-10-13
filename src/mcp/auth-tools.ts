import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { PerUserLinkService } from "../auth/link-service.js";
import { validateApprovalUrl } from "../auth/observed-syntx-provider.js";
import {
  AUTH_LINK_STATUSES,
  AuthLinkError,
  OBSERVED_AUTHORIZATION_PROFILE
} from "../auth/types.js";
import type {
  AuthBinding,
  AuthHandoffResult,
  AuthLinkErrorCode,
  PublicAuthLinkAttempt
} from "../auth/types.js";

export const SYNTX_AUTH_TOOL_NAMES = [
  "syntx_begin_login",
  "syntx_check_login",
  "syntx_unlink"
] as const;

type AuthToolLinkService = Pick<
  PerUserLinkService,
  "createAttempt" | "issueHandoff" | "checkAttempt" | "revoke"
>;

const INVALID_TOOL_INPUT = Symbol("INVALID_TOOL_INPUT");
const INVALID_ATTEMPT_INPUT = "";

class AuthToolInputError extends Error {
  readonly code = "INVALID_TOOL_INPUT" as const;

  constructor() {
    super("The authentication tool input is invalid.");
    this.name = "AuthToolInputError";
  }
}

export interface RegisterSyntxAuthToolsOptions {
  linkService: AuthToolLinkService;
  /** Authenticated server-side identity. It is never accepted from tool input. */
  binding: AuthBinding;
  /** Optional lifecycle hook for resources scoped to a successfully revoked attempt. */
  onRevoked?: (attemptId: string) => void | Promise<void>;
}

const attemptIdSchema = z
  .string()
  .regex(/^link_[A-Za-z0-9_-]{20,120}$/)
  .describe("Opaque login attempt id returned by syntx_begin_login.");

const noInputSchema = z
  .object({})
  .strict()
  .default({})
  .catch(() => ({ [INVALID_TOOL_INPUT]: true }));

const attemptInputSchema = z
  .object({
    attempt_id: attemptIdSchema
      .catch(INVALID_ATTEMPT_INPUT)
      .meta({ default: undefined })
  })
  .loose()
  .meta({ additionalProperties: false });

const publicAttemptSchema = z
  .object({
    attempt_id: attemptIdSchema,
    authorization_profile: z.literal(OBSERVED_AUTHORIZATION_PROFILE),
    status: z.enum(AUTH_LINK_STATUSES),
    expires_at: z.iso.datetime().nullable(),
    linked: z.boolean()
  })
  .strict();

/**
 * Opt-in registration for the observed owner-authorized linking flow.
 * The default MCP server keeps its existing eight-tool surface unless its
 * composition root explicitly calls this function with an authenticated binding.
 */
export function registerSyntxAuthTools(
  server: McpServer,
  options: RegisterSyntxAuthToolsOptions
): void {
  const linkService = options.linkService;
  const binding: AuthBinding = Object.freeze({ ...options.binding });

  server.registerTool(
    "syntx_begin_login",
    {
      title: "Begin SYNTX login",
      description:
        "Create a login attempt for the authenticated MCP principal and return a Telegram approval link. This observed owner-authorized flow is not official OAuth.",
      inputSchema: noInputSchema,
      outputSchema: publicAttemptSchema,
      annotations: authToolAnnotations("Begin SYNTX login", {
        readOnly: false,
        destructive: false,
        idempotent: false
      })
    },
    async (input, { signal }) =>
      handleBeginLoginCall(async () => {
        assertNoToolInput(input);
        const created = await linkService.createAttempt(binding);
        return linkService.issueHandoff(
          binding,
          created.attempt_id,
          signal
        );
      })
  );

  server.registerTool(
    "syntx_check_login",
    {
      title: "Check SYNTX login",
      description:
        "Perform one bounded status check using attempt_id from syntx_begin_login for the authenticated MCP principal. It never returns the approval link or credential.",
      inputSchema: attemptInputSchema,
      outputSchema: publicAttemptSchema,
      annotations: authToolAnnotations("Check SYNTX login", {
        readOnly: false,
        destructive: false,
        idempotent: true
      })
    },
    async (input, { signal }) =>
      handlePublicAttemptCall(() => {
        assertAttemptToolInput(input);
        return linkService.checkAttempt(binding, input.attempt_id, signal);
      })
  );

  server.registerTool(
    "syntx_unlink",
    {
      title: "Unlink SYNTX account",
      description:
        "Locally revoke the login identified by attempt_id for the authenticated MCP principal and delete its process-local credential. It does not claim upstream logout.",
      inputSchema: attemptInputSchema,
      outputSchema: publicAttemptSchema,
      annotations: authToolAnnotations("Unlink SYNTX account", {
        readOnly: false,
        destructive: true,
        idempotent: true
      })
    },
    async (input) =>
      handlePublicAttemptCall(() => {
        assertAttemptToolInput(input);
        return Promise.resolve(linkService.revoke(binding, input.attempt_id)).then(async (attempt) => {
          if (attempt.status === "REVOKED") await options.onRevoked?.(input.attempt_id);
          return attempt;
        });
      })
  );
}

function authToolAnnotations(
  title: string,
  options: {
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
  }
): ToolAnnotations {
  return {
    title,
    readOnlyHint: options.readOnly,
    destructiveHint: options.destructive,
    idempotentHint: options.idempotent,
    openWorldHint: true
  };
}

function assertNoToolInput(input: object): void {
  if (Object.prototype.hasOwnProperty.call(input, INVALID_TOOL_INPUT)) {
    throw new AuthToolInputError();
  }
}

function assertAttemptToolInput(input: { attempt_id: string }): void {
  if (
    input.attempt_id === INVALID_ATTEMPT_INPUT ||
    Object.keys(input).length !== 1
  ) {
    throw new AuthToolInputError();
  }
}

async function handleBeginLoginCall(
  operation: () => AuthHandoffResult | Promise<AuthHandoffResult>
): Promise<CallToolResult> {
  try {
    return beginLoginResult(await operation());
  } catch (error) {
    return authToolError(error);
  }
}

async function handlePublicAttemptCall(
  operation: () => PublicAuthLinkAttempt | Promise<PublicAuthLinkAttempt>
): Promise<CallToolResult> {
  try {
    return publicAttemptResult(await operation());
  } catch (error) {
    return authToolError(error);
  }
}

function beginLoginResult(handoff: AuthHandoffResult): CallToolResult {
  const result = publicAttemptResult(handoff.attempt);
  if (handoff.approval_url === null) {
    if (handoff.attempt.status === "HANDOFF_ISSUED") {
      throw new AuthLinkError(
        "INVALID_APPROVAL_URL",
        "The handoff did not provide an approval URL."
      );
    }
    return result;
  }
  if (handoff.attempt.status !== "HANDOFF_ISSUED") {
    throw new AuthLinkError(
      "AUTH_LINK_INVALID_STATE",
      "The approval URL did not match the handoff state."
    );
  }
  const approvalUrl = validateToolApprovalUrl(handoff.approval_url);

  result.content.push({
    type: "resource_link",
    uri: approvalUrl,
    name: "SYNTX Telegram login",
    title: "Approve SYNTX login",
    description: "Open Telegram to approve this SYNTX account link."
  });
  return result;
}

function validateToolApprovalUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthLinkError(
      "INVALID_APPROVAL_URL",
      "The handoff approval URL is invalid."
    );
  }
  const start = parsed.searchParams.get("start");
  const match = start?.match(/^auth_([0-9a-f-]{36})$/iu);
  const upstreamAttemptId = match?.[1];
  if (upstreamAttemptId === undefined) {
    throw new AuthLinkError(
      "INVALID_APPROVAL_URL",
      "The handoff approval payload is invalid."
    );
  }
  return validateApprovalUrl(value, upstreamAttemptId);
}

function publicAttemptResult(attempt: PublicAuthLinkAttempt): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(attempt) }],
    structuredContent: attempt as unknown as Record<string, unknown>
  };
}

function authToolError(error: unknown): CallToolResult {
  const code: AuthLinkErrorCode | "INVALID_TOOL_INPUT" | "INTERNAL_ERROR" =
    error instanceof AuthToolInputError
      ? error.code
      : error instanceof AuthLinkError
        ? error.code
        : "INTERNAL_ERROR";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code,
            message:
              code === "INTERNAL_ERROR"
                ? "The login operation failed without exposing internal details."
                : code === "INVALID_TOOL_INPUT"
                  ? "Tool input does not match the declared login schema."
                  : safeAuthErrorMessage(code)
          }
        })
      }
    ]
  };
}

/** Never serialize provider messages because they may contain private handoff data. */
function safeAuthErrorMessage(code: AuthLinkErrorCode): string {
  const messages: Record<AuthLinkErrorCode, string> = {
    INVALID_AUTH_BINDING:
      "Login is unavailable for the authenticated MCP principal.",
    INVALID_ATTEMPT_ID: "The login attempt id is invalid.",
    AUTH_LINK_NOT_FOUND:
      "The login attempt is not available for the authenticated MCP principal.",
    AUTH_LINK_INVALID_STATE:
      "The login attempt cannot perform that operation in its current state.",
    AUTH_LINK_EXPIRED: "The login attempt expired; begin a new login.",
    AUTH_CREDENTIAL_UNAVAILABLE:
      "No linked credential is available for this login attempt.",
    AUTH_PROVIDER_RETRYABLE:
      "The login provider is temporarily unavailable; retry this operation.",
    AUTH_PROVIDER_TERMINAL:
      "The login provider rejected this attempt; begin a new login.",
    AUTH_REQUEST_ABORTED: "The login request was canceled by the client.",
    INVALID_API_BASE: "The login provider configuration is unavailable.",
    INVALID_APPROVAL_URL:
      "The login provider did not return an approved Telegram handoff.",
    MALFORMED_PROVIDER_RESPONSE:
      "The login provider returned an invalid response."
  };
  return messages[code];
}
