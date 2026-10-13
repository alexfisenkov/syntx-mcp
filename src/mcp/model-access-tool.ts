import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import {
  ModelAccessError,
  ModelAccessService
} from "../application/model-access.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ApplicationError } from "../errors.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_MODEL_ACCESS_TOOL_NAME = "syntx_get_model_access" as const;

export interface RegisterSyntxModelAccessToolOptions {
  catalog: DiscoveryCatalogRepository;
  /** Creates a tenant-bound client; the attempt id is never accepted as identity. */
  resolveClient: (attemptId: string) => SyntxHttpClient;
  now?: (() => number) | undefined;
}

const attemptIdSchema = z
  .string()
  .regex(/^link_[A-Za-z0-9_-]{20,120}$/);
const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
const scalarSchema = z.union([
  z.string().max(500),
  z.number().finite().nonnegative().max(1_000_000_000),
  z.boolean()
]);
const costParametersSchema = z
  .record(z.string().min(1).max(64), scalarSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 32) {
      context.addIssue({ code: "custom", message: "Too many cost parameters." });
    }
  });

export function registerSyntxModelAccessTool(
  server: McpServer,
  options: RegisterSyntxModelAccessToolOptions
): void {
  server.registerTool(
    SYNTX_MODEL_ACCESS_TOOL_NAME,
    {
      title: "Get SYNTX model access and cost",
      description:
        "Read current account-scoped access, cost, limits, and warnings for one active public model variant. This does not approve or start generation.",
      inputSchema: z
        .object({
          link_attempt_id: attemptIdSchema.describe(
            "Linked attempt returned by syntx_begin_login."
          ),
          model_id: modelIdSchema.describe(
            "Stable variant id returned by syntx_search_models."
          ),
          cost_parameters: costParametersSchema.default({})
            .describe(
              "Caller-supplied cost inputs listed by public settings.get_cost_params. Omit transport-owned ai_name and model_type; both are derived from model_id."
            )
        })
        .strict(),
      outputSchema: z
        .object({
          catalog_kind: z.literal("OFFICIAL_PUBLIC_API_SNAPSHOT"),
          catalog_version: z.string(),
          model_id: z.string(),
          ai_name: z.string(),
          model_type: z.string(),
          account_read_live: z.literal(true),
          parameter_keys: z.array(z.string()),
          parameters_redacted: z.literal(true),
          access: z.boolean().nullable(),
          cost: z.number().nonnegative().nullable(),
          discount_cost: z.number().nonnegative().nullable(),
          free_remaining_generations: z.number().nonnegative().nullable(),
          limit: z.number().nonnegative().nullable(),
          show_warning: z.boolean().nullable(),
          observed_at: z.iso.datetime()
        })
        .strict(),
      annotations: modelAccessAnnotations()
    },
    async ({ link_attempt_id, model_id, cost_parameters }, { signal }) => {
      try {
        const service = new ModelAccessService(
          options.catalog,
          options.resolveClient(link_attempt_id),
          options.now
        );
        const result = await service.getModelAccess(
          { model_id, cost_parameters },
          signal
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>
        };
      } catch (error) {
        return modelAccessToolError(error);
      }
    }
  );
}

function modelAccessAnnotations(): ToolAnnotations {
  return {
    title: "Get SYNTX model access and cost",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  };
}

function modelAccessToolError(error: unknown): CallToolResult {
  const code =
    error instanceof ApplicationError && error.code === "MODEL_NOT_FOUND"
      ? "MODEL_NOT_FOUND"
      : error instanceof ModelAccessError
        ? error.code
        : error instanceof SyntxHttpError
          ? error.code
          : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    ...SYNTX_HTTP_ERROR_MESSAGES,
    MODEL_NOT_FOUND: "The requested model is not available in the public catalog.",
    MODEL_INACTIVE: "The requested public catalog model is inactive.",
    INVALID_COST_PARAMETERS:
      "Cost parameters are not allowlisted for the selected model.",
    INVALID_REQUEST: "The account-scoped model request is invalid."
  };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: { code, message: messages[code] ?? messages.INTERNAL_ERROR }
        })
      }
    ]
  };
}
