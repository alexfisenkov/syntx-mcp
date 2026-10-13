import assert from "node:assert/strict";
import test from "node:test";
import { NodeAeadAuthLinkSecretVault } from "../src/auth/auth-link-secret-vault.js";

const binding = { tenant_id: "tenant_test", subject: "subject_test" } as const;
const attempt = "link_vault_test_attempt_0001";

test("AEAD vault round-trips only with the exact binding", async () => {
  const key = new Uint8Array(32).fill(7);
  const vault = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "key-test");
  const envelope = await vault.seal(binding, attempt, "sentinel-secret");
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(await vault.open(binding, attempt, envelope), "sentinel-secret");
  await assert.rejects(vault.open({ ...binding, subject: "other" }, attempt, envelope));
  assert.equal("sentinel-secret" in envelope, false);
});

test("AEAD vault rejects invalid injected key material", async () => {
  const vault = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => new Uint8Array(8) }, "key-test");
  await assert.rejects(vault.seal(binding, attempt, "secret"), /INVALID_SECRET_KEY/u);
});

test("AEAD vault bounds the credential before encryption", async () => {
  const vault = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => new Uint8Array(32) }, "key-test");
  await assert.rejects(vault.seal(binding, attempt, ""), /INVALID_SECRET_VALUE/u);
  await assert.rejects(vault.seal(binding, attempt, "x".repeat(16 * 1024 + 1)), /INVALID_SECRET_VALUE/u);
});
