#!/usr/bin/env node
import { createServer, type Server as HttpServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { RemoteOwnerOAuthProvider, REMOTE_OWNER_SCOPE, listRemoteOwnerPending, approveRemoteOwnerPending } from "../auth/remote-owner-oauth.js";
import { initializeRemoteOwnerDirectory } from "../auth/remote-owner-state.js";
import { RemoteOwnerStdioBridge, createRemoteOwnerStdioFactory } from "../runtime/remote-owner-stdio-bridge.js";
import { loadRemoteOwnerLaunchConfig, remoteOwnerChildConfiguration } from "./https-owner-config.js";
import { withOmittedAuthArguments } from "./omitted-auth-arguments.js";
import { isMainModule } from "./is-main.js";

export interface RemoteOwnerHttpsServerOptions {
  oauth: RemoteOwnerOAuthProvider;
  bridge: RemoteOwnerStdioBridge;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
}
export interface RemoteOwnerHttpsServer { server: HttpServer; close(): Promise<void>; }

/** TLS terminates at the trusted reverse proxy. This server binds loopback only in its CLI. */
export function createRemoteOwnerHttpsServer(options: RemoteOwnerHttpsServerOptions): RemoteOwnerHttpsServer {
  const { oauth, bridge } = options;
  const origin = new URL(oauth.issuer).origin;
  const origins = new Set([origin, ...(options.allowedOrigins ?? [])]);
  for (const value of origins) { const url = new URL(value); if (url.protocol !== "https:" || url.origin !== value) throw new Error("REMOTE_OWNER_ORIGIN_INVALID"); }
  const maxBytes = options.maxBodyBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 192 * 1024 * 1024) throw new Error("REMOTE_OWNER_BODY_LIMIT_INVALID");
  const app = express();
  const routes = express.Router();
  const basePath = new URL(oauth.issuer).pathname.replace(/\/$/u, "");
  app.disable("x-powered-by"); app.disable("etag");
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    next();
  });
  routes.get("/health", (_req, res) => { res.json({ status: "ok", surface: "private-owner" }); });
  // Fixed number of global buckets: bounded even when callers rotate source addresses behind a proxy.
  const rates = new Map<string, { until: number; count: number }>();
  for (const [path, maximum, interval] of [["/register", 20, 3600_000], ["/authorize", 100, 900_000], ["/token", 120, 900_000], ["/revoke", 120, 900_000], ["/oauth/approval", 3000, 900_000]] as const) {
    routes.use(path, (_req, res, next) => {
      const now = Date.now(); let bucket = rates.get(path);
      if (!bucket || bucket.until <= now) { bucket = { until: now + interval, count: 0 }; rates.set(path, bucket); }
      if (++bucket.count > maximum) { res.status(429).set("Retry-After", String(Math.ceil((bucket.until - now) / 1000))).json({ error: "rate_limit_exceeded" }); return; }
      next();
    });
  }
  const issuerUrl = new URL(oauth.issuer), resourceUrl = new URL(oauth.resource);
  const authOptions = { provider: oauth, issuerUrl, resourceServerUrl: resourceUrl, scopesSupported: [REMOTE_OWNER_SCOPE], resourceName: "Private SYNTX owner installation" };
  // SDK metadata does not advertise RFC9207 yet. Every authorization redirect below is augmented accordingly.
  app.get(`/.well-known/oauth-authorization-server${basePath}`, (_req, res) => {
    res.json({ ...createOAuthMetadata(authOptions), authorization_response_iss_parameter_supported: true,
      authorization_endpoint: new URL("authorize", issuerUrl).href, token_endpoint: new URL("token", issuerUrl).href,
      registration_endpoint: new URL("register", issuerUrl).href, revocation_endpoint: new URL("revoke", issuerUrl).href,
      token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"] });
  });
  app.get(new URL(getOAuthProtectedResourceMetadataUrl(resourceUrl)).pathname, (_req, res) => {
    res.json({ resource: oauth.resource, authorization_servers: [oauth.issuer], scopes_supported: [REMOTE_OWNER_SCOPE], resource_name: authOptions.resourceName });
  });
  routes.use("/authorize", (_req, res, next) => {
    const original = res.redirect.bind(res);
    res.redirect = ((statusOrUrl: number | string, maybeUrl?: string) => {
      const status = typeof statusOrUrl === "number" ? statusOrUrl : 302;
      const location = typeof statusOrUrl === "string" ? statusOrUrl : maybeUrl!;
      const target = new URL(location, oauth.issuer);
      // Internal approval navigation has no authorization response. External success/error callbacks always have iss.
      if (target.searchParams.has("error") || target.searchParams.has("code")) target.searchParams.set("iss", oauth.issuer);
      return original(status, target.href);
    }) as Response["redirect"];
    next();
  });
  // Enforce small auth form bodies before the SDK's default parsers and rate limiters.
  for (const path of ["/authorize", "/token", "/register", "/revoke"]) {
    routes.use(path, express.urlencoded({ extended: false, inflate: false, limit: 16 * 1024, parameterLimit: 32 }), express.json({ inflate: false, limit: 16 * 1024 }));
  }
  routes.get("/oauth/approval/:id", (req, res) => { oauth.approval(req, res); });
  // SDK endpoint handlers are mounted under the prefix. Its generated unprefixed metadata is replaced above.
  routes.use("/.well-known", (_req, res) => { res.status(404).json({ error: "not_found" }); });
  routes.use(mcpAuthRouter(authOptions));
  routes.use("/mcp", (req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (requestOrigin !== undefined && !origins.has(requestOrigin)) { res.status(403).json({ error: "origin_not_allowed" }); return; }
    next();
  }, requireBearerAuth({ verifier: oauth, requiredScopes: [REMOTE_OWNER_SCOPE], expectedResource: resourceUrl,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl) }),
  (req, res, next) => {
    if (req.auth?.extra?.owner_subject !== oauth.ownerSubject || req.auth.extra.issuer !== oauth.issuer) { res.status(401).json({ error: "invalid_owner" }); return; }
    next();
  });
  routes.post("/mcp", express.json({ inflate: false, limit: maxBytes, strict: false }), async (req, res) => {
    if (!req.is("application/json")) { res.status(415).json({ error: "json_required" }); return; }
    let mutatingDispatched = false, disconnected = false;
    const onClose = () => { if (!res.writableFinished) { disconnected = true; if (mutatingDispatched) bridge.markMutationResponseLost(); } };
    res.once("close", onClose);
    try {
      await bridge.ready();
      const mcp = bridge.createServer({ isOpen: () => !disconnected && !res.destroyed, onMutatingDispatch: () => { mutatingDispatched = true; } });
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, allowedOrigins: [...origins], enableDnsRebindingProtection: true });
      try {
        await mcp.connect(withOmittedAuthArguments(transport as unknown as Transport));
        await transport.handleRequest(req, res, req.body);
      } finally { await transport.close(); await mcp.close(); }
    } catch {
      if (!res.headersSent) res.status(503).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Private owner runtime is unavailable. No automatic retry is performed." } });
    } finally { res.off("close", onClose); }
  });
  routes.all("/mcp", (_req, res) => { res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" }); });
  app.use(basePath || "/", routes);
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = (error as { status?: number })?.status;
    res.status(status === 413 ? 413 : status === 415 ? 415 : status === 400 ? 400 : 500).json({ error: status === 413 ? "body_too_large" : status === 415 ? "unsupported_content_encoding" : "request_failed" });
  });
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 60_000, headersTimeout: 30_000 }, app);
  // Allows bounded long media POST responses; incoming body timeout remains separate.
  server.setTimeout(16 * 60_000);
  let closing: Promise<void> | undefined;
  return { server, close() {
    closing ??= (async () => {
      const closed = new Promise<void>((resolve, reject) => { server.close((error) => { if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error); else resolve(); }); });
      try { await bridge.close(); await closed; }
      finally { oauth.close(); }
    })();
    return closing;
  } };
}

export async function remoteOwnerHttpsMain(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      console.log("Usage: syntx-mcp-https serve | init | pending | approve <pending-id>\nSet SYNTX_HTTPS_CONFIG_FILE to a private 0600 JSON launch configuration outside the package."); return 0;
    }
    const [command, id] = argv;
    if (!["serve", "init", "pending", "approve"].includes(command ?? "") || argv.length !== (command === "approve" ? 2 : 1)) throw new Error("REMOTE_OWNER_ARGUMENTS_INVALID");
    const path = process.env.SYNTX_HTTPS_CONFIG_FILE;
    if (!path) throw new Error("REMOTE_OWNER_CONFIG_FILE_REQUIRED");
    const config = loadRemoteOwnerLaunchConfig(path);
    if (command === "init") { initializeRemoteOwnerDirectory(config.stateDirectory); console.log("Private owner OAuth state directory initialized."); return 0; }
    if (command === "pending") {
      console.log(JSON.stringify(listRemoteOwnerPending(config.stateDirectory).map(({ nonce_hash: _nonce, ...view }) => view), null, 2)); return 0;
    }
    if (command === "approve") { approveRemoteOwnerPending(config.stateDirectory, id!); console.log(`Approved private owner request ${id}.`); return 0; }
    const oauth = new RemoteOwnerOAuthProvider({ stateDirectory: config.stateDirectory, issuer: `${config.publicOrigin}${config.basePath}/`, resource: `${config.publicOrigin}${config.basePath}/mcp`,
      ownerSubject: config.ownerSubject, redirectUris: config.redirectUris, allowLoopbackRedirects: config.allowLoopbackRedirects });
    let runtime: RemoteOwnerHttpsServer;
    try {
      const bridge = new RemoteOwnerStdioBridge(createRemoteOwnerStdioFactory(remoteOwnerChildConfiguration(config)));
      runtime = createRemoteOwnerHttpsServer({ oauth, bridge, allowedOrigins: config.allowedOrigins, maxBodyBytes: config.maxBodyBytes });
    } catch (error) { oauth.close(); throw error; }
    try { await new Promise<void>((resolve, reject) => { runtime.server.once("error", reject); runtime.server.listen(config.port, "127.0.0.1", resolve); }); }
    catch (error) { await runtime.close(); throw error; }
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; void runtime.close().catch(() => { process.exitCode = 1; console.error("REMOTE_OWNER_SHUTDOWN_INCOMPLETE"); }); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    console.error("Private owner HTTPS upstream listening on loopback."); return 0;
  } catch { console.error("REMOTE_OWNER_HTTPS_CONFIGURATION_OR_OPERATION_FAILED"); return 1; }
}
if (isMainModule(import.meta.url)) process.exitCode = await remoteOwnerHttpsMain();
