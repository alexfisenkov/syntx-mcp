import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AuthBinding } from "./types.js";

export interface AuthLinkSecretEnvelope {
  readonly schema_version: "1.0.0";
  readonly algorithm: "aes-256-gcm";
  readonly key_handle: string;
  readonly nonce_b64: string;
  readonly ciphertext_b64: string;
  readonly auth_tag_b64: string;
}

export interface AuthLinkSecretKeyResolver {
  resolveKey(keyHandle: string): Promise<Uint8Array>;
  destroyEnvelope?(keyHandle: string, envelope: AuthLinkSecretEnvelope): Promise<void>;
}

export interface AuthLinkSecretVault {
  seal(binding: AuthBinding, attemptId: string, secret: string): Promise<AuthLinkSecretEnvelope>;
  open(binding: AuthBinding, attemptId: string, envelope: AuthLinkSecretEnvelope): Promise<string>;
  destroy(envelope: AuthLinkSecretEnvelope): Promise<void>;
}

/** AES-GCM envelope helper; key material is always supplied by an injected resolver. */
export class NodeAeadAuthLinkSecretVault implements AuthLinkSecretVault {
  readonly #keys: AuthLinkSecretKeyResolver;
  readonly #keyHandle: string;
  constructor(keys: AuthLinkSecretKeyResolver, keyHandle: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(keyHandle)) throw new Error("INVALID_KEY_HANDLE");
    this.#keys = keys; this.#keyHandle = keyHandle;
  }
  async seal(binding: AuthBinding, attemptId: string, secret: string): Promise<AuthLinkSecretEnvelope> {
    if (typeof secret !== "string" || secret.length === 0 || Buffer.byteLength(secret, "utf8") > 16 * 1024) throw new Error("INVALID_SECRET_VALUE");
    const iv = randomBytes(12);
    const actual = createCipheriv("aes-256-gcm", await this.#key(), iv);
    actual.setAAD(aad(binding, attemptId));
    const ciphertext = Buffer.concat([actual.update(secret, "utf8"), actual.final()]);
    return Object.freeze({ schema_version: "1.0.0", algorithm: "aes-256-gcm", key_handle: this.#keyHandle, nonce_b64: iv.toString("base64url"), ciphertext_b64: ciphertext.toString("base64url"), auth_tag_b64: actual.getAuthTag().toString("base64url") });
  }
  async open(binding: AuthBinding, attemptId: string, envelope: AuthLinkSecretEnvelope): Promise<string> {
    if (envelope.schema_version !== "1.0.0" || envelope.algorithm !== "aes-256-gcm" || envelope.key_handle !== this.#keyHandle) throw new Error("INVALID_SECRET_ENVELOPE");
    const decipher = createDecipheriv("aes-256-gcm", await this.#key(), Buffer.from(envelope.nonce_b64, "base64url"));
    decipher.setAAD(aad(binding, attemptId)); decipher.setAuthTag(Buffer.from(envelope.auth_tag_b64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext_b64, "base64url")), decipher.final()]).toString("utf8");
  }
  async destroy(envelope: AuthLinkSecretEnvelope): Promise<void> { if (envelope.key_handle !== this.#keyHandle) throw new Error("INVALID_SECRET_ENVELOPE"); await this.#keys.destroyEnvelope?.(envelope.key_handle, envelope); }
  async #key(): Promise<Buffer> { const key = Buffer.from(await this.#keys.resolveKey(this.#keyHandle)); if (key.length !== 32) throw new Error("INVALID_SECRET_KEY"); return key; }
}
function aad(binding: AuthBinding, attemptId: string): Buffer { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(binding.tenant_id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(binding.subject) || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) throw new Error("INVALID_SECRET_BINDING"); return Buffer.from(`syntx-auth-v1\0${binding.tenant_id}\0${binding.subject}\0${attemptId}`, "utf8"); }
