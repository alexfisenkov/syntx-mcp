// Local-only R9 HTTPS lifecycle repro with synthetic OAuth and fake bridge.
// No external network, production profile, provider call or server source edit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { request as httpRequest, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const release = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const { RemoteOwnerOAuthProvider, approveRemoteOwnerPending, REMOTE_OWNER_SCOPE } =
  await import(pathToFileURL(join(release, 'dist/src/auth/remote-owner-oauth.js')).href);
const { createRemoteOwnerHttpsServer } = await import(pathToFileURL(join(release, 'dist/src/transports/https-owner.js')).href);
const { RemoteOwnerStdioBridge } = await import(pathToFileURL(join(release, 'dist/src/runtime/remote-owner-stdio-bridge.js')).href);

test('large HTTPS tools/list completes and late paid disconnect keeps the mutation circuit closed to writes only', { timeout: 30000 }, async () => {
const state = mkdtempSync(join(realpathSync(tmpdir()), 'syntx-https-lifecycle-'));
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const issuer = 'https://owner.example/syntx-ai/';
const resource = issuer + 'mcp';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const description = 'Synthetic static descriptor. '.repeat(130);
const tools = Array.from({ length: 409 }, (_, i) => ({
  name: 'syntx_read_' + String(i).padStart(3, '0'), description,
  inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true }
}));
tools.push({ name: 'syntx_paid_test', description: 'Synthetic local fake mutation.',
  inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } });
let paidCalls = 0, readCalls = 0;
const fake = {
  async listTools() { return { tools }; },
  async listResources() { return { resources: [] }; },
  async readResource() { return { contents: [] }; },
  async callTool(name) {
    if (name === 'syntx_paid_test') { paidCalls++; return { content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] }; }
    readCalls++; return { content: [{ type: 'text', text: 'safe local read' }] };
  },
  async close() {}
};
const oauth = new RemoteOwnerOAuthProvider({ stateDirectory: state, issuer, resource,
  ownerSubject: 'synthetic-owner', redirectUris: [redirect] });
const bridge = new RemoteOwnerStdioBridge(async () => fake);
const runtime = createRemoteOwnerHttpsServer({ oauth, bridge, maxBodyBytes: 1024 * 1024 });
let serverResponse = null;
const originalEnd = ServerResponse.prototype.end;
const originalOff = ServerResponse.prototype.off;
let activeAbortRequest = null, lateOffSnapshot = null;
let endCount = 0, closeOffCount = 0;

function post(base, path, body, headers) {
  return fetch(base + path, { method: 'POST', headers, body });
}
async function localToken(base) {
  const registered = await post(base, '/register', JSON.stringify({ client_name: 'local synthetic',
    redirect_uris: [redirect], token_endpoint_auth_method: 'none' }), { 'Content-Type': 'application/json' });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect,
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    resource, scope: REMOTE_OWNER_SCOPE, state: 'local' });
  const begun = await fetch(base + '/authorize?' + query, { redirect: 'manual' });
  assert.equal(begun.status, 303);
  const cookie = begun.headers.getSetCookie().map(x => x.split(';', 1)[0]).join('; ');
  const approvalPath = new URL(begun.headers.get('location'), issuer).pathname;
  approveRemoteOwnerPending(state, approvalPath.split('/').at(-1));
  const completed = await fetch(new URL(base).origin + approvalPath, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(completed.status, 303);
  const code = new URL(completed.headers.get('location')).searchParams.get('code');
  const exchanged = await post(base, '/token', new URLSearchParams({ grant_type: 'authorization_code',
    client_id: client.client_id, code, code_verifier: verifier, redirect_uri: redirect, resource }),
  { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(exchanged.status, 200);
  return (await exchanged.json()).access_token;
}
function slowMcp(port, token, method, params, abortFirstChunk = false) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: abortFirstChunk ? 22 : 21, method, params });
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/syntx-ai/mcp', method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(body) } });
    if (abortFirstChunk) activeAbortRequest = req;
    req.on('error', error => { if (!abortFirstChunk) reject(error); else resolve(lateOffSnapshot ?? { late_off_not_seen: true }); });
    req.on('response', res => {
      let bytes = 0, chunks = [], ended = false, settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      res.on('data', chunk => {
        bytes += chunk.length;
        if (!abortFirstChunk) {
          chunks.push(chunk); res.pause(); setTimeout(() => res.resume(), 8);
        } else if (!settled) res.pause();
      });
      res.on('end', () => { ended = true; if (!abortFirstChunk) finish({ status: res.statusCode,
        content_length: Number(res.headers['content-length']), bytes, complete: res.complete,
        parsed_tool_count: JSON.parse(Buffer.concat(chunks).toString()).result?.tools?.length ?? null }); });
      res.on('error', error => { if (!abortFirstChunk && !ended) reject(error); else if (abortFirstChunk) finish(lateOffSnapshot ?? { late_off_not_seen: true }); });
      res.on('close', () => { if (!abortFirstChunk && !ended) reject(Error('PREMATURE_CLOSE')); else if (abortFirstChunk) finish(lateOffSnapshot ?? { late_off_not_seen: true }); });
    });
    req.end(body);
    if (abortFirstChunk) setTimeout(() => {
      req.destroy(); resolve(lateOffSnapshot ?? { late_off_not_seen: true });
    }, 3000).unref();
  });
}

const out = { status: 'UNVERIFIED', mode: 'LOCAL_SYNTHETIC_ONLY' };
try {
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port, base = `http://127.0.0.1:${port}/syntx-ai`;
  const token = await localToken(base);
  const list = await slowMcp(port, token, 'tools/list', {}, false);
  out.large_tools_list = { ...list, exact_length: list.content_length === list.bytes,
    full_json_410: list.parsed_tool_count === 410 };
  assert.equal(list.status, 200);
  assert.equal(list.content_length, list.bytes);
  assert.equal(list.parsed_tool_count, 410);
  ServerResponse.prototype.end = function (...args) {
    endCount++; serverResponse = this;
    const socket = activeAbortRequest && paidCalls === 1 ? this.socket : null;
    const uncork = socket?.uncork;
    if (socket) { socket.cork(); socket.uncork = () => {}; }
    const value = originalEnd.apply(this, args);
    if (activeAbortRequest && paidCalls === 1) setImmediate(() => {
      lateOffSnapshot = { server_end_seen: this.writableEnded,
        server_finished_before_abort: this.writableFinished, server_headers_sent: this.headersSent,
        app_close_listener_present: this.listeners('close').some(fn => fn.name === 'onClose') };
      activeAbortRequest.destroy();
      if (socket) socket.uncork = uncork;
    });
    return value;
  };
  ServerResponse.prototype.off = function (event, listener) {
    const relevant = event === 'close' && activeAbortRequest && paidCalls === 1;
    if (relevant) closeOffCount++;
    const value = originalOff.apply(this, arguments);
    if (relevant) {
      // Diagnostic only: the end callback performs the timed disconnect.
    }
    return value;
  };
  const abort = await slowMcp(port, token, 'tools/call', { name: 'syntx_paid_test', arguments: {} }, true);
  await new Promise(resolve => setTimeout(resolve, 80));
  const before = paidCalls;
  const second = await bridge.callTool('syntx_paid_test', {}, { isOpen: () => true, onMutatingDispatch() {} });
  const read = await bridge.callTool('syntx_read_000', {});
  out.late_disconnect = { ...abort, fake_paid_calls_before_probe: before,
    fake_paid_calls_after_probe: paidCalls, second_blocked: second.isError === true,
    read_only_survives: read.isError !== true && readCalls === 1,
    server_end_count: endCount, close_off_count: closeOffCount };
  out.status = 'PASS_LIST_INTEGRITY';
} catch (error) {
  out.status = 'FAIL';
  out.safe_error = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{0,70}$/.test(error.message)
    ? error.message : error?.name ?? 'LOCAL_REPRO_FAILED';
} finally {
  ServerResponse.prototype.end = originalEnd;
  ServerResponse.prototype.off = originalOff;
  await runtime.close().catch(() => { out.cleanup = 'RUNTIME_CLOSE_FAILED'; });
  rmSync(state, { recursive: true, force: true });
  assert.equal(out.status, 'PASS_LIST_INTEGRITY', JSON.stringify(out));
  assert.equal(out.large_tools_list.status, 200);
  assert.ok(out.large_tools_list.content_length > 1_600_000);
  assert.equal(out.large_tools_list.content_length, out.large_tools_list.bytes);
  assert.equal(out.large_tools_list.complete, true);
  assert.equal(out.large_tools_list.parsed_tool_count, 410);
  assert.equal(out.late_disconnect.server_end_seen, true);
  assert.equal(out.late_disconnect.server_finished_before_abort, false);
  assert.equal(out.late_disconnect.app_close_listener_present, true);
  assert.equal(out.late_disconnect.fake_paid_calls_before_probe, 1);
  assert.equal(out.late_disconnect.fake_paid_calls_after_probe, 1);
  assert.equal(out.late_disconnect.second_blocked, true);
  assert.equal(out.late_disconnect.read_only_survives, true);
}
});
