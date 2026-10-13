#!/usr/bin/env node
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ApplicationCore } from "../application/core.js";
import { createDefaultApplication } from "../application/factory.js";
import {
  createMcpServer,
  SERVER_VERSION,
  type CreateMcpServerOptions
} from "../mcp/server.js";
import { isMainModule } from "./is-main.js";
import { withOmittedAuthArguments } from "./omitted-auth-arguments.js";

export interface HttpServerOptions {
  /**
   * Resolve an authenticated, tenant-scoped application for this request.
   * Implementations must not fall back to a cross-tenant shared application.
   */
  resolveApplication?: ApplicationResolver;
  /** Resolve optional auth/read surfaces from the same authenticated request. */
  resolveMcpServerOptions?: McpServerOptionsResolver;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
}

export type ApplicationResolver = (
  request: IncomingMessage
) => ApplicationCore | Promise<ApplicationCore>;

export type McpServerOptionsResolver = (
  request: IncomingMessage
) => CreateMcpServerOptions | Promise<CreateMcpServerOptions>;

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const resolveApplication: ApplicationResolver =
    options.resolveApplication ?? (() => createDefaultApplication());
  const resolveMcpServerOptions: McpServerOptionsResolver =
    options.resolveMcpServerOptions ?? (() => ({}));
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        status: "ok",
        version: SERVER_VERSION
      });
      return;
    }

    if (pathname !== "/mcp") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    if (!isOriginAllowed(request.headers.origin, allowedOrigins)) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      });
      return;
    }

    try {
      const body = await readJsonBody(request, maxBodyBytes);
      const application = await resolveApplication(request);
      const serverOptions = await resolveMcpServerOptions(request);
      const mcpServer = createMcpServer(application, serverOptions);
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        allowedOrigins: [...allowedOrigins],
        enableDnsRebindingProtection: allowedOrigins.size > 0
      });
      // SDK 1.30.0's Node transport and base Transport disagree only under
      // exactOptionalPropertyTypes; the class is the SDK's intended transport.
      const facade = withOmittedAuthArguments(
        transport as unknown as Transport
      );
      await mcpServer.connect(facade);
      try {
        await transport.handleRequest(request, response, body);
      } finally {
        await transport.close();
        await mcpServer.close();
      }
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof HttpInputError ? error.status : 500;
        sendJson(response, status, {
          jsonrpc: "2.0",
          error: {
            code: status === 500 ? -32603 : -32600,
            message:
              error instanceof HttpInputError
                ? error.message
                : "Internal server error"
          },
          id: null
        });
      }
    }
  });
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>
): boolean {
  if (origin === undefined) return true;
  return allowedOrigins.has(origin);
}

class HttpInputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new HttpInputError(415, "Content-Type must be application/json.");
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBodyBytes) {
      throw new HttpInputError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpInputError(400, "Request body is not valid JSON.");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown
): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3000");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

if (isMainModule(import.meta.url)) {
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST ?? "127.0.0.1";
  const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length
    ? configuredOrigins
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const httpServer = createHttpServer({ allowedOrigins });
  httpServer.listen(port, host, () => {
    console.error(`MCP HTTP server listening on http://${host}:${port}/mcp`);
  });
}
