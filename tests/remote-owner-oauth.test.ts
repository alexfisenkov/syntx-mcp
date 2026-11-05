import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { RemoteOwnerOAuthProvider, approveRemoteOwnerPending, listRemoteOwnerPending, REMOTE_OWNER_SCOPE } from "../src/auth/remote-owner-oauth.js";
import { createRemoteOwnerHttpsServer, remoteOwnerHttpsMain } from "../src/transports/https-owner.js";
import { RemoteOwnerStdioBridge, createRemoteOwnerStdioFactory, type RemoteOwnerChildFactory, type RemoteOwnerChildPort } from "../src/runtime/remote-owner-stdio-bridge.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/client/auth.js";

const issuer = "https://owner.example/";
const resource = "https://owner.example/mcp";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
function options(stateDirectory: string, prefix = "") { return { stateDirectory, issuer: `https://owner.example${prefix}/`, resource: `https://owner.example${prefix}/mcp`, ownerSubject: "private-owner", redirectUris: [redirect] }; }
async function fixture(prefix = "", now?: () => number, overrides: Partial<RemoteOwnerChildPort> = {}, childFactory?: RemoteOwnerChildFactory) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-oauth-"));
  let starts = 0;
  const oauth = new RemoteOwnerOAuthProvider({ ...options(directory, prefix), ...(now === undefined ? {} : { now }) });
  let reference: string | undefined;
  const fake: RemoteOwnerChildPort = {
    async listTools() { return { tools: [{ name: "syntx_test_read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "syntx_test_upload", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } }] }; },
    async listResources() { return { resources: [] }; }, async readResource() { return { contents: [] }; },
    async callTool(name, args) {
      if (name === "syntx_test_upload") { reference = "owned-reference"; return { content: [], structuredContent: { reference_handle: reference } }; }
      return { content: [{ type: "text", text: "safe" }], structuredContent: { valid: args?.reference_handle === reference && reference !== undefined } };
    }, async close() {}, ...overrides
  };
  const bridge = new RemoteOwnerStdioBridge(async (onLost) => { starts++; return childFactory ? await childFactory(onLost) : fake; });
  const runtime = createRemoteOwnerHttpsServer({ oauth, bridge, maxBodyBytes: 1024 });
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const base = `${root}${prefix}`;
  return { directory, oauth, base, root, prefix, issuer: oauth.issuer, resource: oauth.resource, starts: () => starts,
    close: async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function register(f: Fixture, override: object = {}): Promise<Record<string, string>> {
  const response = await fetch(`${f.base}/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT test", redirect_uris: [redirect], token_endpoint_auth_method: "none", ...override }) });
  assert.equal(response.status, 201); return await response.json() as Record<string, string>;
}
async function begin(f: Fixture, client: string, override: Record<string, string> = {}) {
  const query = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", resource: f.resource, scope: REMOTE_OWNER_SCOPE, state: "expected-state", ...override });
  const response = await fetch(`${f.base}/authorize?${query}`, { redirect: "manual" });
  return { response, cookie: response.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; "),
    path: new URL(response.headers.get("location") ?? "/", f.issuer).pathname };
}
async function approvedCode(f: Fixture, client: string): Promise<string> {
  const request = await begin(f, client); assert.equal(request.response.status, 303);
  const id = request.path.split("/").at(-1)!;
  approveRemoteOwnerPending(f.directory, id);
  const response = await fetch(`${f.root}${request.path}`, { headers: { Cookie: request.cookie }, redirect: "manual" });
  assert.equal(response.status, 303);
  const callback = new URL(response.headers.get("location")!);
  assert.equal(callback.searchParams.get("iss"), f.issuer); assert.equal(callback.searchParams.get("state"), "expected-state");
  return callback.searchParams.get("code")!;
}
async function token(f: Fixture, client: string, code: string, override: Record<string, string> = {}) {
  return await fetch(`${f.base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client, code, code_verifier: verifier, redirect_uri: redirect, resource: f.resource, ...override }) });
}

test("remote owner metadata, unauthorized and forged tokens never start the child", async () => {
  const f = await fixture();
  try {
    const metadata = await (await fetch(`${f.base}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
    assert.equal(metadata.issuer, issuer); assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]); assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
    assert.equal(metadata.registration_endpoint, `${issuer}register`);
    const protectedMetadata = await (await fetch(`${f.base}/.well-known/oauth-protected-resource/mcp`)).json() as Record<string, unknown>;
    assert.equal(protectedMetadata.resource, resource); assert.deepEqual(protectedMetadata.authorization_servers, [issuer]);
    for (const auth of [undefined, "Bearer forged"]) {
      const result = await fetch(`${f.base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: "{}" });
      assert.equal(result.status, 401); assert.match(result.headers.get("www-authenticate")!, /resource_metadata=.*oauth-protected-resource\/mcp/u);
    }
    assert.equal(f.starts(), 0);
  } finally { await f.close(); }
});

test("remote owner approval requires terminal AND browser nonce; S256, client, resource and one-use code are enforced", async () => {
  const f = await fixture();
  try {
    const client = await register(f), other = await register(f);
    const request = await begin(f, client.client_id!); assert.equal(request.response.status, 303);
    const cookie = request.response.headers.getSetCookie()[0]!;
    assert.match(cookie, /HttpOnly/u); assert.match(cookie, /Secure/u); assert.match(cookie, /SameSite=Lax/u);
    assert.equal((await fetch(`${f.base}${request.path}`)).status, 403);
    const page = await fetch(`${f.base}${request.path}`, { headers: { Cookie: request.cookie } });
    assert.equal(page.status, 200); assert.match(await page.text(), /syntx-mcp-https approve [a-f0-9]{32}/u);
    const pending = listRemoteOwnerPending(f.directory); assert.equal(pending.length, 1);
    assert.equal(pending[0]!.client_id, client.client_id); assert.equal(pending[0]!.redirect_uri, redirect);
    assert.throws(() => approveRemoteOwnerPending(f.directory, "../../not-a-request"));
    approveRemoteOwnerPending(f.directory, pending[0]!.id);
    assert.equal((await fetch(`${f.base}${request.path}`, { headers: { Cookie: request.cookie.replace(/=.*/u, "=wrong-nonce") }, redirect: "manual" })).status, 403);
    const result = await fetch(`${f.base}${request.path}`, { headers: { Cookie: request.cookie }, redirect: "manual" });
    const location = new URL(result.headers.get("location")!); const code = location.searchParams.get("code")!;
    assert.equal(location.searchParams.get("iss"), issuer); assert.equal(location.searchParams.get("state"), "expected-state");
    assert.equal((await fetch(`${f.base}${request.path}`, { headers: { Cookie: request.cookie }, redirect: "manual" })).status, 403);
    assert.equal((await token(f, other.client_id!, code)).status, 400);
    assert.equal((await token(f, client.client_id!, code, { code_verifier: "wrong" })).status, 400);
    assert.equal((await token(f, client.client_id!, code, { resource: "https://other.example/mcp" })).status, 400);
    assert.equal((await token(f, client.client_id!, code, { redirect_uri: `${redirect}?wrong=1` })).status, 400);
    const exchange = await token(f, client.client_id!, code); assert.equal(exchange.status, 200);
    const tokens = await exchange.json() as Record<string, string>;
    assert.equal((await token(f, client.client_id!, code)).status, 400);
    const info = await f.oauth.verifyAccessToken(tokens.access_token!);
    assert.equal(info.extra?.owner_subject, "private-owner"); assert.equal(info.resource!.href, resource); assert.deepEqual(info.scopes, [REMOTE_OWNER_SCOPE]);
    const persisted = readFileSync(join(f.directory, "oauth.sqlite"));
    assert.equal(persisted.includes(tokens.access_token!), false); assert.equal(persisted.includes(tokens.refresh_token!), false); assert.equal(persisted.includes(code), false);
    assert.equal(f.starts(), 0);
  } finally { await f.close(); }
});

test("remote owner DCR rejects untrusted redirect/secret/scope and all OAuth callback errors carry issuer", async () => {
  const f = await fixture();
  try {
    for (const body of [
      { redirect_uris: ["https://attacker.example/callback"], token_endpoint_auth_method: "none" },
      { redirect_uris: [redirect], token_endpoint_auth_method: "client_secret_post" },
      { redirect_uris: [redirect], token_endpoint_auth_method: "none", scope: "admin" }
    ]) assert.equal((await fetch(`${f.base}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 400);
    const client = await register(f);
    for (const invalid of [{ scope: "admin" }, { resource: "https://other.example/mcp" }, { code_challenge_method: "plain" }]) {
      const response = (await begin(f, client.client_id!, invalid)).response;
      assert.equal(response.status, 302); const url = new URL(response.headers.get("location")!);
      assert.ok(url.searchParams.has("error")); assert.equal(url.searchParams.get("iss"), issuer);
    }
    assert.equal(f.starts(), 0);
  } finally { await f.close(); }
});

test("remote owner refresh rotates, cannot escalate scope/client/resource, revoke invalidates grant family", async () => {
  const f = await fixture();
  try {
    const client = await register(f), other = await register(f);
    const response = await token(f, client.client_id!, await approvedCode(f, client.client_id!));
    const first = await response.json() as Record<string, string>;
    const refresh = async (override: Record<string, string> = {}) => await fetch(`${f.base}/token`, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id!,
        refresh_token: first.refresh_token!, resource, ...override }) });
    assert.equal((await refresh({ scope: "admin" })).status, 400);
    assert.equal((await refresh({ client_id: other.client_id! })).status, 400);
    assert.equal((await refresh({ resource: "https://other.example/mcp" })).status, 400);
    const secondResponse = await refresh(); assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json() as Record<string, string>;
    assert.notEqual(first.refresh_token, second.refresh_token); assert.equal((await refresh()).status, 400);
    const revoke = await fetch(`${f.base}/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id!, token: second.refresh_token! }) });
    assert.equal(revoke.status, 200);
    await assert.rejects(f.oauth.verifyAccessToken(first.access_token!)); await assert.rejects(f.oauth.verifyAccessToken(second.access_token!));
  } finally { await f.close(); }
});

test("remote owner tokens and registered public client persist, but cannot cross deployment/owner identities", async () => {
  const f = await fixture(), other = await fixture();
  try {
    const client = await register(f); const response = await token(f, client.client_id!, await approvedCode(f, client.client_id!));
    const tokens = await response.json() as Record<string, string>;
    await assert.rejects(other.oauth.verifyAccessToken(tokens.access_token!));
    assert.throws(() => new RemoteOwnerOAuthProvider({ ...options(f.directory), ownerSubject: "different-owner" }), /IDENTITY_MISMATCH/u);
    // Open the same identity store to verify persisted hashes, without touching the child or provider.
    const reopened = new RemoteOwnerOAuthProvider(options(f.directory));
    try { assert.equal((await reopened.clientsStore.getClient(client.client_id!))?.client_id, client.client_id); await reopened.verifyAccessToken(tokens.access_token!); }
    finally { reopened.close(); }
    assert.equal(f.starts(), 0); assert.equal(other.starts(), 0);
  } finally { await f.close(); await other.close(); }
});

test("prefixed private owner OAuth discovery, SDK HTTP sessions, reference state, origin and body limits", async () => {
  const f = await fixture("/syntx-ai");
  try {
    const metadata = await (await fetch(`${f.root}/.well-known/oauth-authorization-server/syntx-ai`)).json() as Record<string, unknown>;
    assert.equal(metadata.issuer, f.issuer); assert.equal(metadata.authorization_endpoint, "https://owner.example/syntx-ai/authorize");
    assert.equal(metadata.token_endpoint, "https://owner.example/syntx-ai/token"); assert.equal(metadata.registration_endpoint, "https://owner.example/syntx-ai/register");
    assert.equal((await fetch(`${f.root}/.well-known/oauth-authorization-server`)).status, 404);
    const prm = await (await fetch(`${f.root}/.well-known/oauth-protected-resource/syntx-ai/mcp`)).json() as Record<string, unknown>;
    assert.equal(prm.resource, f.resource); assert.deepEqual(prm.authorization_servers, [f.issuer]);
    const localFetch: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, "https://owner.example");
      return fetch(`${f.root}${url.pathname}${url.search}`, init);
    };
    assert.equal((await discoverAuthorizationServerMetadata(f.issuer, { fetchFn: localFetch }))?.issuer, f.issuer);
    assert.equal((await discoverOAuthProtectedResourceMetadata(f.resource, {
      resourceMetadataUrl: "https://owner.example/.well-known/oauth-protected-resource/syntx-ai/mcp" }, localFetch)).resource, f.resource);
    const noAuth = await fetch(`${f.base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401); assert.match(noAuth.headers.get("www-authenticate")!, /oauth-protected-resource\/syntx-ai\/mcp/u);
    const client = await register(f); const exchange = await token(f, client.client_id!, await approvedCode(f, client.client_id!));
    assert.equal(exchange.status, 200); const tokens = await exchange.json() as Record<string, string>;
    const headers = { Authorization: `Bearer ${tokens.access_token!}`, "Content-Type": "application/json" };
    assert.equal((await fetch(`${f.base}/mcp`, { method: "POST", headers: { ...headers, Origin: "https://attacker.example" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${f.base}/mcp`, { method: "POST", headers, body: JSON.stringify("x".repeat(2000)) })).status, 413);
    assert.equal(f.starts(), 0);
    const open = async () => {
      const sdk = new Client({ name: "prefixed-owner-test", version: "1" });
      await sdk.connect(new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), { requestInit: { headers: { Authorization: headers.Authorization } } }) as unknown as Transport);
      return sdk;
    };
    const one = await open();
    let handle: unknown;
    try {
      const tools = await one.listTools(); assert.deepEqual(tools.tools[0]!._meta?.securitySchemes, [{ type: "oauth2", scopes: [REMOTE_OWNER_SCOPE] }]);
      handle = ((await one.callTool({ name: "syntx_test_upload" })).structuredContent as Record<string, unknown> | undefined)?.reference_handle;
    } finally { await one.close(); }
    const two = await open();
    try { assert.equal(((await two.callTool({ name: "syntx_test_read", arguments: { reference_handle: handle } })).structuredContent as Record<string, unknown> | undefined)?.valid, true); }
    finally { await two.close(); }
    assert.equal(f.starts(), 1);
  } finally { await f.close(); }
});

test("compressed malformed OAuth and MCP requests keep HTTPS and its actual singleton stdio child alive", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url);
  const module = (id: string) => pathToFileURL(require.resolve(id)).href;
  const script = `
    import {McpServer} from ${JSON.stringify(module("@modelcontextprotocol/sdk/server/mcp.js"))};
    import {StdioServerTransport} from ${JSON.stringify(module("@modelcontextprotocol/sdk/server/stdio.js"))};
    import {z} from ${JSON.stringify(module("zod/v4"))};
    const server=new McpServer({name:'offline-security-child',version:'1'});
    server.registerTool('syntx_test_read',{inputSchema:z.object({choice:z.enum(['first','second']),refs:z.array(z.string()).max(3).optional()}),
      outputSchema:z.object({pid:z.number().int().positive(),choice:z.enum(['first','second'])}),annotations:{readOnlyHint:true}},async(input)=>({content:[],structuredContent:{pid:process.pid,choice:input.choice}}));
    server.registerResource('maintenance','syntx://maintenance/skill',{},async()=>({contents:[{uri:'syntx://maintenance/skill',text:'safe offline fixture'}]}));
    server.server.onclose=()=>process.stdin.destroy();
    await server.connect(new StdioServerTransport());
  `;
  const factory = createRemoteOwnerStdioFactory({ command: realpathSync(process.execPath), args: ["--input-type=module", "-e", script], cwd: process.cwd(), env: {} });
  const f = await fixture("/syntx-ai", undefined, {}, factory); let pid: number | undefined;
  const sdk = new Client({ name: "security-regression", version: "1" });
  try {
    const registered = await register(f), exchanged = await token(f, registered.client_id!, await approvedCode(f, registered.client_id!));
    const tokens = await exchanged.json() as Record<string, string>, auth = { Authorization: `Bearer ${tokens.access_token!}` };
    await sdk.connect(new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), { requestInit: { headers: auth } }) as unknown as Transport);
    const tools = await sdk.listTools(), descriptor = tools.tools.find(tool => tool.name === "syntx_test_read")!;
    assert.deepEqual((descriptor.inputSchema.properties?.choice as { enum: unknown }).enum, ["first", "second"]);
    assert.equal((descriptor.inputSchema.properties?.refs as { maxItems: unknown }).maxItems, 3);
    assert.ok(descriptor.outputSchema?.properties?.pid, "actual SDK still advertises output schema after Zod patch");
    pid = ((await sdk.callTool({ name: "syntx_test_read", arguments: { choice: "first" } })).structuredContent as { pid: number }).pid;
    assert.notEqual(pid, process.pid); process.kill(pid, 0); assert.equal(f.starts(), 1);
    for (const [encoding, body] of [["gzip", Buffer.concat([gzipSync(Buffer.from("{}")), Buffer.from([0xde, 0xad, 0xbe, 0xef])])],
      ["br", Buffer.concat([brotliCompressSync(Buffer.from("{}")), Buffer.from([0xde, 0xad, 0xbe, 0xef])])]] as const) {
      for (const path of ["register", "token", "mcp"]) {
        const response = await fetch(`${f.base}/${path}`, { method: "POST", headers: { ...auth, "Content-Type": path === "token" ? "application/x-www-form-urlencoded" : "application/json", "Content-Encoding": encoding }, body });
        assert.equal(response.status, 415); await response.arrayBuffer();
      }
      assert.equal((await fetch(`${f.base}/health`)).status, 200);
      const after = await sdk.callTool({ name: "syntx_test_read", arguments: { choice: "second", refs: ["safe"] } });
      assert.deepEqual(after.structuredContent, { pid, choice: "second" }); process.kill(pid, 0); assert.equal(f.starts(), 1);
    }
    const rejected = await sdk.callTool({ name: "syntx_test_read", arguments: { choice: "unlisted" } }); assert.equal(rejected.isError, true);
  } finally { await sdk.close(); await f.close(); }
  if (pid !== undefined) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("remote owner CLI approves only the private pending record and never prints its nonce hash", async () => {
  const f = await fixture();
  const previous = process.env.SYNTX_HTTPS_CONFIG_FILE;
  const log = console.log, error = console.error, output: string[] = [];
  try {
    const client = await register(f), request = await begin(f, client.client_id!);
    const pending = listRemoteOwnerPending(f.directory)[0]!;
    const config = join(f.directory, "launch.json");
    writeFileSync(config, JSON.stringify({ publicOrigin: "https://owner.example", ownerSubject: "private-owner", stateDirectory: f.directory,
      redirectUris: [redirect], child: { nodeExecutable: realpathSync(process.execPath), environment: {} } }), { mode: 0o600 });
    process.env.SYNTX_HTTPS_CONFIG_FILE = config;
    console.log = (value) => { output.push(String(value)); }; console.error = (value) => { output.push(String(value)); };
    assert.equal(await remoteOwnerHttpsMain(["pending"]), 0);
    assert.equal(output.join("").includes(pending.nonce_hash), false); assert.equal(output.join("").includes("nonce_hash"), false);
    assert.equal(await remoteOwnerHttpsMain(["approve", pending.id]), 0);
    assert.equal(statSync(join(f.directory, `approved_${pending.id}.json`)).mode & 0o777, 0o600);
    assert.equal(output.join("").includes(request.cookie.split("=", 2)[1]!), false);
    const callback = await fetch(`${f.base}${request.path}`, { headers: { Cookie: request.cookie }, redirect: "manual" }); assert.equal(callback.status, 303);
    assert.equal(await remoteOwnerHttpsMain(["approve", pending.id]), 1);
    assert.equal(f.starts(), 0);
  } finally {
    console.log = log; console.error = error;
    if (previous === undefined) delete process.env.SYNTX_HTTPS_CONFIG_FILE; else process.env.SYNTX_HTTPS_CONFIG_FILE = previous;
    await f.close();
  }
});

test("remote owner access/code/refresh/pending TTLs reject stale grants while registered client remains valid", async () => {
  let now = Date.now(); const f = await fixture("", () => now);
  try {
    const client = await register(f), pending = await begin(f, client.client_id!);
    now += 11 * 60_000;
    assert.equal((await fetch(`${f.root}${pending.path}`, { headers: { Cookie: pending.cookie } })).status, 403);
    assert.deepEqual(listRemoteOwnerPending(f.directory, now), []);
    const staleCode = await approvedCode(f, client.client_id!); now += 61_000;
    assert.equal((await token(f, client.client_id!, staleCode)).status, 400);
    const response = await token(f, client.client_id!, await approvedCode(f, client.client_id!)); assert.equal(response.status, 200);
    const tokens = await response.json() as Record<string, string>;
    await f.oauth.verifyAccessToken(tokens.access_token!);
    now += 3601_000; await assert.rejects(f.oauth.verifyAccessToken(tokens.access_token!));
    now += 31 * 24 * 60 * 60_000;
    const expiredRefresh = await fetch(`${f.base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id!, refresh_token: tokens.refresh_token!, resource }) });
    assert.equal(expiredRefresh.status, 400); assert.equal((await f.oauth.clientsStore.getClient(client.client_id!))?.client_id, client.client_id);
    assert.equal(f.starts(), 0);
  } finally { await f.close(); }
});

test("disconnect after mutating dispatch preserves child result, opens mutation circuit and allows read-only reconciliation", { timeout: 10_000 }, async () => {
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const dispatched = new Promise<void>((resolve) => { entered = resolve; });
  let mutations = 0, result = "pending";
  const f = await fixture("", undefined, { async callTool(name) {
    if (name === "syntx_test_upload") { mutations++; entered(); await barrier; result = "old-result"; return { content: [], structuredContent: { result } }; }
    return { content: [{ type: "text", text: result }], structuredContent: { result } };
  } });
  const controller = new AbortController();
  try {
    const client = await register(f), exchange = await token(f, client.client_id!, await approvedCode(f, client.client_id!));
    const tokens = await exchange.json() as Record<string, string>;
    const headers = { Authorization: `Bearer ${tokens.access_token!}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const lostResponse = fetch(`${f.base}/mcp`, { method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "syntx_test_upload", arguments: {} } }) });
    // Attach rejection before abort so no rejected fetch escapes the test.
    const rejected = assert.rejects(lostResponse);
    await dispatched; controller.abort(); await rejected;
    await new Promise((resolve) => setTimeout(resolve, 20)); release();
    const read = await fetch(`${f.base}/mcp`, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "syntx_test_read", arguments: {} } }) });
    const readBody = await read.json() as { result: { structuredContent: { result: string } } };
    assert.equal(readBody.result.structuredContent.result, "old-result");
    const repeat = await fetch(`${f.base}/mcp`, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "syntx_test_upload", arguments: {} } }) });
    assert.match(JSON.stringify(await repeat.json()), /OUTCOME_UNKNOWN/u); assert.equal(mutations, 1); assert.equal(f.starts(), 1);
  } finally { controller.abort(); release(); await f.close(); }
});
