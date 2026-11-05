import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListResourceTemplatesRequestSchema,
  CallToolResultSchema, type CallToolResult, type ListToolsResult, type ListResourcesResult, type ReadResourceResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isRemoteOwnerToolAllowed, REMOTE_OWNER_RESOURCE_URIS } from "./remote-owner-tool-policy.js";
import { describeRemoteMediaFileTool, resolveRemoteMediaFileArguments } from "./remote-owner-media-file-input.js";
import { REMOTE_OWNER_SCOPE } from "../auth/remote-owner-oauth.js";
import { OWNER_STDIO_MAX_BUFFER_BYTES } from "../transports/owner-stdio-buffer.js";

export const REMOTE_OWNER_TOOL_TIMEOUT_MS = 15 * 60_000;
export interface RemoteOwnerChildPort {
  listTools(cursor?: string): Promise<ListToolsResult>;
  listResources(cursor?: string): Promise<ListResourcesResult>;
  readResource(uri: string): Promise<ReadResourceResult>;
  callTool(name: string, args: Record<string, unknown> | undefined): Promise<CallToolResult>;
  close(): Promise<void>;
}
export type RemoteOwnerChildFactory = (onLost: () => void) => Promise<RemoteOwnerChildPort>;
export interface RemoteOwnerChildConfiguration { command: string; args: string[]; cwd: string; env: Record<string, string>; }
export interface RemoteOwnerResponseContext {
  isOpen(): boolean;
  onMutatingDispatch(): void;
}

/** Trusted fixed launch configuration only. Never accept these fields from MCP or an OAuth client. */
export function createRemoteOwnerStdioFactory(config: RemoteOwnerChildConfiguration): RemoteOwnerChildFactory {
  // Snapshot before serving requests; HTTP-provided tokens are never passed into the child.
  const selected = { command: config.command, args: [...config.args], cwd: config.cwd,
    env: { ...config.env, SYNTX_SELF_UPDATE: "0", SYNTX_OWNER_LOCAL_IMAGE_FILES: "0", SYNTX_LOCAL_IMAGE_ROOTS: "[]", SYNTX_STDIO_MAX_BUFFER_BYTES: String(OWNER_STDIO_MAX_BUFFER_BYTES) } };
  return async (onLost) => {
    const client = new Client({ name: "syntx-private-owner-https", version: "1.0.0" });
    const transport = new StdioClientTransport({ ...selected, maxBufferSize: 64 * 1024 * 1024, stderr: "ignore" });
    client.onclose = onLost;
    try { await client.connect(transport as unknown as Transport, { timeout: 30_000 }); }
    catch { await transport.close(); throw new Error("REMOTE_OWNER_CHILD_START_FAILED"); }
    return {
      listTools: (cursor) => client.listTools(cursor === undefined ? {} : { cursor }, { timeout: 30_000 }),
      listResources: (cursor) => client.listResources(cursor === undefined ? {} : { cursor }, { timeout: 30_000 }),
      readResource: (uri) => client.readResource({ uri }, { timeout: 30_000 }),
      callTool: async (name, args) => await client.callTool({ name, ...(args === undefined ? {} : { arguments: args }) }, CallToolResultSchema,
        { timeout: REMOTE_OWNER_TOOL_TIMEOUT_MS, maxTotalTimeout: REMOTE_OWNER_TOOL_TIMEOUT_MS }) as CallToolResult,
      close: async () => {
        const pid = transport.pid;
        await client.close(); // SDK ends stdin first, then bounded TERM/KILL fallback; no respawn.
        if (pid !== null) {
          for (let i = 0; i < 20; i++) {
            try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw new Error("REMOTE_OWNER_CHILD_EXIT_UNVERIFIED"); }
            await new Promise((done) => setTimeout(done, 50));
          }
          throw new Error("REMOTE_OWNER_CHILD_EXIT_UNVERIFIED");
        }
      }
    };
  };
}

/** One child lifetime per private deployment; never one child per HTTP request/session. */
export class RemoteOwnerStdioBridge {
  readonly #factory: RemoteOwnerChildFactory;
  #port: Promise<RemoteOwnerChildPort> | undefined;
  #tools: Promise<Tool[]> | undefined;
  #lost = false;
  #paidCircuitOpen = false;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #calls = new Set<Promise<CallToolResult>>();
  constructor(factory: RemoteOwnerChildFactory) { this.#factory = factory; }

  /** Must only be reached after protected-resource authentication. No constructor side effects. */
  async ready(): Promise<void> { await this.#getPort(); }
  async #getPort(): Promise<RemoteOwnerChildPort> {
    if (this.#closing || this.#lost) throw new Error("REMOTE_OWNER_BRIDGE_UNAVAILABLE");
    this.#port ??= this.#factory(() => { this.#lost = true; this.#paidCircuitOpen = true; }).catch(() => {
      this.#lost = true; throw new Error("REMOTE_OWNER_BRIDGE_UNAVAILABLE");
    });
    return this.#port;
  }
  async listTools(): Promise<Tool[]> {
    const port = await this.#getPort();
    this.#tools ??= (async () => {
      const tools: Tool[] = [], cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 32; page++) {
        const result = await port.listTools(cursor);
        tools.push(...result.tools.filter(isRemoteOwnerToolAllowed));
        if (tools.length > 1024) throw new Error("REMOTE_OWNER_TOOL_LIMIT");
        if (!result.nextCursor) return tools;
        if (cursors.has(result.nextCursor)) throw new Error("REMOTE_OWNER_CURSOR_REPEATED");
        cursor = result.nextCursor; cursors.add(cursor);
      }
      throw new Error("REMOTE_OWNER_PAGE_LIMIT");
    })();
    return this.#tools;
  }
  async callTool(name: string, args?: Record<string, unknown>, responseContext?: RemoteOwnerResponseContext): Promise<CallToolResult> {
    const tools = await this.listTools();
    const tool = tools.find((item) => item.name === name);
    if (!tool) return safeError("REMOTE_TOOL_NOT_AVAILABLE", "This tool is not available on the private HTTPS surface.");
    if (this.#closing || this.#lost) return safeError("REMOTE_OWNER_UNAVAILABLE", "The owner runtime is unavailable. No call was dispatched.");
    const paid = tool.annotations?.readOnlyHint !== true;
    if (paid && this.#paidCircuitOpen) return safeError("OUTCOME_UNKNOWN", "A previous dispatched call has an unknown outcome. Do not repeat generation; use read-only reconciliation.");
    if (this.#calls.size >= 2) return safeError("REMOTE_OWNER_BUSY", "Two owner tool calls are already running. Wait for a result before submitting another call.");
    const operation = (async () => {
      let dispatched = false;
      let prepared: Awaited<ReturnType<typeof resolveRemoteMediaFileArguments>> | undefined;
      try {
        const port = await this.#getPort();
        prepared = await resolveRemoteMediaFileArguments(tool, args ?? {});
        if (paid && responseContext) {
          if (!responseContext.isOpen()) return safeError("REMOTE_RESPONSE_CLOSED", "The response closed before dispatch. No mutation was dispatched.");
          responseContext.onMutatingDispatch();
        }
        dispatched = true;
        return await port.callTool(name, prepared.arguments);
      }
      catch {
        if (!dispatched) return safeError("REMOTE_INPUT_UNAVAILABLE", "The tool input could not be prepared safely. No child tool call was dispatched.");
        if (paid) this.#paidCircuitOpen = true;
        return safeError(paid ? "OUTCOME_UNKNOWN" : "REMOTE_READ_FAILED", paid
          ? "The dispatched operation outcome is unknown. Do not retry automatically; use read-only reconciliation."
          : "The owner read operation did not complete.");
      } finally { prepared?.dispose(); }
    })();
    this.#calls.add(operation);
    try { return await operation; } finally { this.#calls.delete(operation); }
  }
  async listResources(): Promise<ListResourcesResult> {
    const port = await this.#getPort();
    const resources: ListResourcesResult["resources"] = [], seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 16; page++) {
      const result = await port.listResources(cursor);
      for (const resource of result.resources) if (REMOTE_OWNER_RESOURCE_URIS.has(resource.uri) && !seen.has(resource.uri)) { resources.push(resource); seen.add(resource.uri); }
      if (!result.nextCursor) return { resources };
      if (result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    throw new Error("REMOTE_OWNER_RESOURCE_PAGE_LIMIT");
  }
  async readResource(uri: string): Promise<ReadResourceResult> {
    if (!REMOTE_OWNER_RESOURCE_URIS.has(uri)) throw new Error("REMOTE_OWNER_RESOURCE_UNAVAILABLE");
    const result = await (await this.#getPort()).readResource(uri);
    if (result.contents.some((item) => item.uri !== uri)) throw new Error("REMOTE_OWNER_RESOURCE_UNAVAILABLE");
    return result;
  }
  /** Operator must reconcile unknown work before explicitly restarting the service. Never a model-callable reset. */
  markMutationResponseLost(): void { this.#paidCircuitOpen = true; }
  createServer(responseContext?: RemoteOwnerResponseContext): Server {
    const server = new Server({ name: "syntx-private-owner-https", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        return { tools: (await this.listTools()).map((tool) => {
          const described = describeRemoteMediaFileTool(tool);
          const securitySchemes = [{ type: "oauth2", scopes: [REMOTE_OWNER_SCOPE] }];
          return { ...described, securitySchemes, _meta: { ...described._meta, securitySchemes } };
        }) };
      } catch { throw new Error("REMOTE_OWNER_TOOLS_UNAVAILABLE"); }
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try { return await this.callTool(request.params.name, request.params.arguments, responseContext); }
      catch { return safeError("REMOTE_OWNER_UNAVAILABLE", "The owner runtime is unavailable. No automatic retry is performed."); }
    });
    server.setRequestHandler(ListResourcesRequestSchema, async () => { try { return await this.listResources(); } catch { throw new Error("REMOTE_OWNER_RESOURCES_UNAVAILABLE"); } });
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try { return await this.readResource(request.params.uri); }
      catch { throw new Error("REMOTE_OWNER_RESOURCE_UNAVAILABLE"); }
    });
    return server;
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = (async () => {
      await Promise.allSettled([...this.#calls]);
      if (this.#port) { let port: RemoteOwnerChildPort; try { port = await this.#port; } catch { return; } await port.close(); }
    })();
    return this.#closePromise;
  }
}
function safeError(code: string, message: string): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] }; }
