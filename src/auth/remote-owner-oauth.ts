import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { Request, Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTokenError, TemporarilyUnavailableError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { RemoteOwnerOAuthStore, readRemoteOwnerPrivateJson, writeRemoteOwnerPrivateJson, removeRemoteOwnerStateFile, pendingRemoteOwnerFiles } from "./remote-owner-state.js";

export const REMOTE_OWNER_SCOPE = "syntx:owner";
const PENDING_TTL = 10 * 60_000;
const CODE_TTL = 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
const MAX_PENDING = 32;
const MAX_CLIENTS = 128;
const MAX_TOKENS = 4096;
const MAX_CODES = 128;
const ID = /^[a-f0-9]{32}$/u;
const opaque = () => randomBytes(32).toString("base64url");
export const remoteOwnerHash = (value: string): string => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const html = (value: string): string => value.replace(/[&<>"']/gu, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]!);

export interface RemoteOwnerOAuthOptions {
  stateDirectory: string;
  issuer: string;
  resource: string;
  ownerSubject: string;
  /** Exact trusted callbacks, not supplied by DCR. No wildcards. */
  redirectUris: readonly string[];
  allowLoopbackRedirects?: boolean;
  now?: () => number;
}
interface Grant {
  client: string; scopes: string[]; resource: string; owner: string; family: string;
}
interface Code extends Grant { redirect: string; challenge: string; }
interface Token extends Grant { kind: "access" | "refresh"; expires: number; }
interface Pending extends Code { id: string; state?: string; nonceHash: string; expires: number; }
export interface RemoteOwnerPendingView { id: string; client_id: string; client_name: string; redirect_uri: string; scopes: string[]; resource: string; nonce_hash: string; expires_at: number; }

/** A single deployment owner approves every OAuth grant through the private terminal, never a web button. */
export class RemoteOwnerOAuthProvider implements OAuthServerProvider {
  readonly #store: RemoteOwnerOAuthStore;
  readonly #pending = new Map<string, Pending>();
  readonly #now: () => number;
  readonly issuer: string;
  readonly resource: string;
  readonly ownerSubject: string;
  readonly stateDirectory: string;
  readonly #redirectUris: Set<string>;
  readonly #allowLoopback: boolean;
  readonly clientsStore: OAuthServerProvider["clientsStore"];
  #closed = false;

  constructor(options: RemoteOwnerOAuthOptions) {
    const issuer = new URL(options.issuer);
    const resource = new URL(options.resource);
    if (issuer.protocol !== "https:" || !/^(?:\/[A-Za-z0-9_-]+)*\/$/u.test(issuer.pathname) || issuer.search || issuer.hash || issuer.username || issuer.password ||
        resource.protocol !== "https:" || resource.origin !== issuer.origin || resource.pathname !== `${issuer.pathname}mcp` || resource.username || resource.password || resource.search || resource.hash ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.ownerSubject) || options.redirectUris.length < 1 || options.redirectUris.length > 16) {
      throw new Error("REMOTE_OWNER_OAUTH_CONFIGURATION_INVALID");
    }
    this.issuer = issuer.href;
    this.resource = resource.href;
    this.ownerSubject = options.ownerSubject;
    this.stateDirectory = options.stateDirectory;
    this.#now = options.now ?? Date.now;
    this.#redirectUris = new Set(options.redirectUris);
    this.#allowLoopback = options.allowLoopbackRedirects === true;
    for (const redirect of this.#redirectUris) this.#validateRedirect(redirect);
    this.#store = new RemoteOwnerOAuthStore(options.stateDirectory, JSON.stringify([this.issuer, this.resource, this.ownerSubject]));
    this.clientsStore = {
      getClient: (id) => { this.#assertOpen(); return this.#store.get<OAuthClientInformationFull>("client", id, this.#now()); },
      registerClient: (input) => {
        this.#prune();
        if (this.#store.count("client") >= MAX_CLIENTS) throw new TemporarilyUnavailableError("Owner client capacity reached.");
        if (input.token_endpoint_auth_method !== "none" || input.redirect_uris.length < 1 || input.redirect_uris.length > 8 ||
            input.client_secret !== undefined || input.client_name && input.client_name.length > 120 ||
            input.grant_types?.some((g) => g !== "authorization_code" && g !== "refresh_token") ||
            input.response_types?.some((r) => r !== "code")) throw new InvalidClientMetadataError("Only public authorization-code clients are supported.");
        for (const redirect of input.redirect_uris) this.#validateRedirect(redirect);
        if (input.scope !== undefined) this.#scopes(input.scope.split(" "));
        // Do not persist arbitrary untrusted DCR extensions or client-supplied identifiers.
        const client: OAuthClientInformationFull = { client_id: `owner_${randomBytes(16).toString("hex")}`, client_id_issued_at: Math.floor(this.#now() / 1000),
          redirect_uris: [...input.redirect_uris], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"], scope: REMOTE_OWNER_SCOPE, ...(input.client_name === undefined ? {} : { client_name: input.client_name }) };
        this.#store.put("client", client.client_id, client, 0);
        return client;
      }
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.#prune();
    this.#validateResource(params.resource);
    this.#validateRedirect(params.redirectUri);
    if (!client.redirect_uris.includes(params.redirectUri) || !/^[A-Za-z0-9_-]{43}$/u.test(params.codeChallenge) ||
        params.state !== undefined && (params.state.length > 2048 || /[\x00-\x1f\x7f]/u.test(params.state))) throw new InvalidRequestError("Invalid authorization request.");
    const scopes = this.#scopes(params.scopes ?? []);
    // Files may outlive a crashed process. Count them too; restart never turns old approvals into new grants.
    listRemoteOwnerPending(this.stateDirectory, this.#now());
    if (pendingRemoteOwnerFiles(this.stateDirectory).length >= MAX_PENDING) throw new TemporarilyUnavailableError("Owner approval capacity reached.");
    const id = randomBytes(16).toString("hex");
    const nonce = opaque();
    const pending: Pending = { id, client: client.client_id, scopes, resource: this.resource, owner: this.ownerSubject,
      family: randomBytes(16).toString("hex"), redirect: params.redirectUri, challenge: params.codeChallenge,
      ...(params.state === undefined ? {} : { state: params.state }), nonceHash: remoteOwnerHash(nonce), expires: this.#now() + PENDING_TTL };
    writeRemoteOwnerPrivateJson(this.stateDirectory, `pending_${id}.json`, {
      id, client_id: pending.client, client_name: client.client_name ?? "OAuth client", redirect_uri: pending.redirect,
      scopes, resource: pending.resource, nonce_hash: pending.nonceHash, expires_at: pending.expires
    } satisfies RemoteOwnerPendingView);
    this.#pending.set(id, pending);
    res.cookie(this.#cookie(id), nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: PENDING_TTL });
    res.redirect(303, `${new URL(this.issuer).pathname}oauth/approval/${id}`);
  }

  /** Cookie binds browser that initiated /authorize; knowing the printed approval id grants no access. */
  approval(req: Request, res: Response): void {
    this.#prune();
    const id = String(req.params.id);
    const pending = ID.test(id) ? this.#pending.get(id) : undefined;
    const cookies = (req.headers.cookie ?? "").split(";").map((c) => c.trim());
    const candidate = cookies.find((c) => c.startsWith(`${this.#cookie(id)}=`))?.slice(this.#cookie(id).length + 1);
    if (!pending || !candidate || candidate.length > 256 || !equal(remoteOwnerHash(candidate), pending.nonceHash)) {
      res.status(403).json({ error: "approval_unavailable" }); return;
    }
    let approved = false;
    try {
      const value = readRemoteOwnerPrivateJson(join(this.stateDirectory, `approved_${id}.json`)) as Record<string, unknown>;
      approved = value.id === id && value.nonce_hash === pending.nonceHash && value.expires_at === pending.expires;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { res.status(503).json({ error: "approval_unavailable" }); return; } }
    if (approved) {
      if (this.#store.count("code") >= MAX_CODES || this.#store.count("token") + 2 > MAX_TOKENS) { res.status(503).json({ error: "owner_capacity_reached" }); return; }
      const code = opaque();
      const { id: _id, state: _state, nonceHash: _nonceHash, expires: _expires, ...record } = pending;
      this.#store.put("code", remoteOwnerHash(code), record, this.#now() + CODE_TTL);
      this.#removePending(id);
      res.clearCookie(this.#cookie(id), { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      const callback = new URL(pending.redirect);
      callback.searchParams.set("code", code);
      callback.searchParams.set("iss", this.issuer);
      if (pending.state !== undefined) callback.searchParams.set("state", pending.state);
      res.redirect(303, callback.href); return;
    }
    res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="3"><title>Approve private SYNTX connection</title><h1>Approve private SYNTX connection</h1><p>Only this deployment owner may authorize access. Review this request in the trusted server terminal before approval.</p><dl><dt>Client</dt><dd>${html(pending.client)}</dd><dt>Redirect</dt><dd>${html(pending.redirect)}</dd><dt>Permissions</dt><dd>${html(pending.scopes.join(" "))}</dd><dt>Resource</dt><dd>${html(pending.resource)}</dd></dl><p>In the trusted terminal run:</p><pre>syntx-mcp-https approve ${id}</pre><p>Expires in 10 minutes. This page checks approval automatically.</p></html>`);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    this.#prune();
    const record = this.#store.get<Code>("code", remoteOwnerHash(code), this.#now());
    if (!record || record.client !== client.client_id) throw new InvalidGrantError("Authorization code is unavailable.");
    return record.challenge;
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirect?: string, resource?: URL): Promise<OAuthTokens> {
    this.#prune();
    this.#validateResource(resource);
    const key = remoteOwnerHash(code);
    const record = this.#store.get<Code>("code", key, this.#now());
    if (!record || record.client !== client.client_id || record.redirect !== redirect || record.owner !== this.ownerSubject) throw new InvalidGrantError("Authorization code is unavailable.");
    this.#checkTokenCapacity();
    if (!this.#store.take<Code>("code", key, this.#now())) throw new InvalidGrantError("Authorization code has been consumed.");
    // PKCE S256 is checked by the installed SDK token handler before invoking this method.
    return this.#issue(record);
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, refresh: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    this.#prune(); this.#validateResource(resource);
    const key = remoteOwnerHash(refresh);
    const token = this.#store.get<Token>("token", key, this.#now());
    if (!token || token.kind !== "refresh" || token.client !== client.client_id || token.owner !== this.ownerSubject) throw new InvalidGrantError("Refresh token is unavailable.");
    const requested = scopes === undefined ? token.scopes : this.#scopes(scopes);
    if (requested.some((scope) => !token.scopes.includes(scope))) throw new InvalidScopeError("Scope escalation is not allowed.");
    this.#checkTokenCapacity();
    if (!this.#store.take<Token>("token", key, this.#now())) throw new InvalidGrantError("Refresh token has been consumed.");
    return this.#issue({ ...token, scopes: requested });
  }
  async verifyAccessToken(raw: string): Promise<AuthInfo> {
    this.#prune();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(raw)) throw new InvalidTokenError("Token is unavailable.");
    const token = this.#store.get<Token>("token", remoteOwnerHash(raw), this.#now());
    if (!token || token.kind !== "access" || token.owner !== this.ownerSubject || token.resource !== this.resource ||
        !this.#store.get("client", token.client, this.#now()) || !token.scopes.includes(REMOTE_OWNER_SCOPE)) throw new InvalidTokenError("Token is unavailable.");
    return { token: raw, clientId: token.client, scopes: [...token.scopes], expiresAt: Math.floor(token.expires / 1000),
      resource: new URL(token.resource), extra: { owner_subject: this.ownerSubject, issuer: this.issuer } };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.#prune();
    const token = this.#store.get<Token>("token", remoteOwnerHash(request.token), this.#now());
    if (token?.client === client.client_id) this.#store.deleteFamily(token.family);
  }
  close(): void { if (this.#closed) return; this.#closed = true; for (const id of this.#pending.keys()) this.#removePending(id); this.#store.close(); }

  #cookie(id: string): string { return `__Host-syntx-${id}`; }
  #assertOpen(): void { if (this.#closed) throw new TemporarilyUnavailableError("Owner authorization service is closed."); }
  #prune(): void {
    this.#assertOpen(); this.#store.prune(this.#now());
    for (const [id, item] of this.#pending) if (item.expires <= this.#now()) this.#removePending(id);
  }
  #removePending(id: string): void { this.#pending.delete(id); for (const prefix of ["pending", "approved"]) removeRemoteOwnerStateFile(this.stateDirectory, `${prefix}_${id}.json`); }
  #scopes(scopes: string[]): string[] {
    if (scopes.length === 0) return [REMOTE_OWNER_SCOPE];
    if (scopes.length !== 1 || scopes[0] !== REMOTE_OWNER_SCOPE) throw new InvalidScopeError("Only syntx:owner is available.");
    return [REMOTE_OWNER_SCOPE];
  }
  #validateResource(resource?: URL): void { if (resource?.href !== this.resource) throw new InvalidRequestError("The exact protected resource is required."); }
  #validateRedirect(value: string): void {
    let url: URL; try { url = new URL(value); } catch { throw new InvalidClientMetadataError("Invalid redirect URI."); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!this.#redirectUris.has(value) || url.username || url.password || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && this.#allowLoopback)) ||
        loopback && !this.#allowLoopback || value.length > 2048) throw new InvalidClientMetadataError("Redirect URI is not allowed for this deployment.");
  }
  #checkTokenCapacity(): void { if (this.#store.count("token") + 2 > MAX_TOKENS) throw new TemporarilyUnavailableError("Owner token capacity reached."); }
  #issue(grant: Grant): OAuthTokens {
    const access = opaque(), refresh = opaque(), now = this.#now();
    const record: Grant = { client: grant.client, scopes: grant.scopes, resource: this.resource, owner: this.ownerSubject, family: grant.family };
    this.#store.put("token", remoteOwnerHash(access), { ...record, kind: "access", expires: now + ACCESS_TTL } satisfies Token, now + ACCESS_TTL);
    this.#store.put("token", remoteOwnerHash(refresh), { ...record, kind: "refresh", expires: now + REFRESH_TTL } satisfies Token, now + REFRESH_TTL);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: grant.scopes.join(" ") };
  }
}

export function listRemoteOwnerPending(directory: string, now = Date.now()): RemoteOwnerPendingView[] {
  return pendingRemoteOwnerFiles(directory).flatMap((name) => {
    const value = readRemoteOwnerPrivateJson(join(directory, name)) as RemoteOwnerPendingView;
    if (ID.test(value.id) && value.expires_at <= now) {
      removeRemoteOwnerStateFile(directory, name); removeRemoteOwnerStateFile(directory, `approved_${value.id}.json`); return [];
    }
    return ID.test(value.id) && value.expires_at > now ? [value] : [];
  });
}

/** Only run from the trusted local terminal. Prints neither browser nonce nor token/code. */
export function approveRemoteOwnerPending(directory: string, id: string, now = Date.now()): void {
  if (!ID.test(id)) throw new Error("REMOTE_OWNER_APPROVAL_ID_INVALID");
  const value = listRemoteOwnerPending(directory, now).find((item) => item.id === id);
  if (!value || !/^[a-f0-9]{64}$/u.test(value.nonce_hash)) throw new Error("REMOTE_OWNER_APPROVAL_UNAVAILABLE");
  writeRemoteOwnerPrivateJson(directory, `approved_${id}.json`, { id, nonce_hash: value.nonce_hash, expires_at: value.expires_at });
}
