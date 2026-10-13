import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  ACCOUNT_CONTRACT_EVIDENCE,
  ACCOUNT_DATE_KINDS,
  ACCOUNT_SOURCE_BUILD
} from "../adapter/syntx/account-decoder.js";
import { SyntxHttpError, type SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { AccountStatusService } from "../application/account-status.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_ACCOUNT_STATUS_TOOL_NAME = "syntx_get_account_status" as const;

export interface RegisterSyntxAccountStatusToolOptions {
  /** Server-owned binding must scope the exact attempt; the id is not identity. */
  resolveClient: (attemptId: string) => SyntxHttpClient;
  now?: (() => number) | undefined;
}

export function registerSyntxAccountStatusTool(
  server: McpServer,
  options: RegisterSyntxAccountStatusToolOptions
): void {
  server.registerTool(SYNTX_ACCOUNT_STATUS_TOOL_NAME, {
    title: "Get SYNTX account balance and subscription",
    description:
      "Read token balance, active-plan flag, plan type, and subscription end date for one linked account. Unknown fields are null, not zero or false. Date-only and timezone-free dates are not UTC instants. Uses an observed frontend contract, not a published API. Two sequential reads are not an atomic snapshot; this does not approve spending or enforce a cost cap.",
    inputSchema: z.object({
      link_attempt_id: z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
        .describe("Exact linked attempt returned by syntx_begin_login.")
    }).strict(),
    outputSchema: z.object({
      balance: z.object({
        unit: z.literal("tokens"),
        available: z.string().max(128).regex(/^[+-]?\d+(?:\.\d+)?$/u).nullable()
      }).strict(),
      subscription: z.object({
        active: z.boolean().nullable(),
        plan_type: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u).nullable(),
        end_date: z.string().max(40).nullable(),
        end_date_kind: z.enum(ACCOUNT_DATE_KINDS).nullable()
      }).strict(),
      contract_evidence: z.literal(ACCOUNT_CONTRACT_EVIDENCE),
      source_build: z.literal(ACCOUNT_SOURCE_BUILD),
      observed_at: z.iso.datetime()
    }).strict(),
    annotations: {
      title: "Get SYNTX account balance and subscription",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ link_attempt_id }, { signal }) => {
    try {
      const service = new AccountStatusService(options.resolveClient(link_attempt_id), options.now);
      const result = await service.getAccountStatus(signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>
      };
    } catch (error) {
      return accountStatusToolError(error);
    }
  });
}

function accountStatusToolError(error: unknown): CallToolResult {
  const code = error instanceof SyntxHttpError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    ...SYNTX_HTTP_ERROR_MESSAGES,
    INVALID_REQUEST: "The account-status request is invalid."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({
      error: { code, message: messages[code] ?? messages.INTERNAL_ERROR }
    }) }]
  };
}
