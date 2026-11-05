import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { assertRemoteOwnerOutsideRepository, readRemoteOwnerPrivateJson } from "../auth/remote-owner-state.js";
import type { RemoteOwnerChildConfiguration } from "../runtime/remote-owner-stdio-bridge.js";
import { OWNER_STDIO_MAX_BUFFER_BYTES } from "./owner-stdio-buffer.js";

const configurationSchema = z.object({
  publicOrigin: z.string().url(), stateDirectory: z.string(), ownerSubject: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  basePath: z.string().max(128).regex(/^(?:\/[A-Za-z0-9_-]+)*$/u).default(""),
  redirectUris: z.array(z.string().url().max(2048)).min(1).max(16),
  allowedOrigins: z.array(z.string().url()).max(16).default([]),
  allowLoopbackRedirects: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(3031),
  maxBodyBytes: z.number().int().min(1024).max(192 * 1024 * 1024).default(32 * 1024 * 1024),
  child: z.object({ nodeExecutable: z.string(), environment: z.record(z.string(), z.string().max(8192)) }).strict()
}).strict();
export type RemoteOwnerLaunchConfig = z.infer<typeof configurationSchema>;

export function loadRemoteOwnerLaunchConfig(path: string): RemoteOwnerLaunchConfig {
  assertRemoteOwnerOutsideRepository(path);
  const config = configurationSchema.parse(readRemoteOwnerPrivateJson(path));
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== config.publicOrigin || origin.username || origin.password) throw new Error("REMOTE_OWNER_PUBLIC_ORIGIN_INVALID");
  for (const value of config.allowedOrigins) { const url = new URL(value); if (url.protocol !== "https:" || url.origin !== value) throw new Error("REMOTE_OWNER_ORIGIN_INVALID"); }
  if (!isAbsolute(config.stateDirectory) || !isAbsolute(config.child.nodeExecutable) || realpathSync(config.child.nodeExecutable) !== config.child.nodeExecutable) throw new Error("REMOTE_OWNER_LAUNCH_PATH_INVALID");
  return config;
}

/** Resolve the canonical entry from THIS installed package; caller cannot select another module/argv. */
export function remoteOwnerChildConfiguration(config: RemoteOwnerLaunchConfig): RemoteOwnerChildConfiguration {
  const entry = join(dirname(fileURLToPath(import.meta.url)), "stdio-owner.js");
  let cwd = dirname(entry);
  for (let i = 0; i < 6; i++) {
    try { if (JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).name === "syntx-mcp") break; } catch { /* continue upwards */ }
    cwd = dirname(cwd);
  }
  const environment = config.child.environment;
  if (!environment.SYNTX_OWNER_AUTH_PROFILE_DIRECTORY || !environment.SYNTX_OWNER_AUTH_KEY_FILE ||
      environment.SYNTX_OWNER_MEDIA_PROFILE !== "all-supported") throw new Error("REMOTE_OWNER_PRIVATE_MEDIA_PROFILE_REQUIRED");
  if (environment.SYNTX_OWNER_AUTH_PROFILE_DIRECTORY === config.stateDirectory) throw new Error("REMOTE_OWNER_STATE_AND_SYNTX_PROFILE_MUST_DIFFER");
  // Authentication is performed through the normal Telegram link in the child; no token forwarding.
  if (Object.keys(environment).some((key) => !/^SYNTX_[A-Z0-9_]+$/u.test(key) || /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/u.test(key))) throw new Error("REMOTE_OWNER_CHILD_ENVIRONMENT_INVALID");
  return { command: config.child.nodeExecutable, args: [entry], cwd, env: { ...environment, SYNTX_SELF_UPDATE: "0", SYNTX_OWNER_LOCAL_IMAGE_FILES: "0", SYNTX_LOCAL_IMAGE_ROOTS: "[]", SYNTX_STDIO_MAX_BUFFER_BYTES: String(OWNER_STDIO_MAX_BUFFER_BYTES) } };
}
