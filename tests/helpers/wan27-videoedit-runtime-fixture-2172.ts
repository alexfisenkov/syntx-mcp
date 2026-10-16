import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyntxChatHttpClient } from "../../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../../src/auth/types.js";
import { minimalWan27Mp4Header, wan27VideoEditProbeFixture } from "./wan27-videoedit-fixtures-2163.js";

export const WAN27_VIDEOEDIT_FIXTURE_ATTEMPT = "link_wan27_videoedit_generation_2172_0123456789abcdef";
export const WAN27_VIDEOEDIT_FIXTURE_BINDING: AuthBinding = Object.freeze({
  tenant_id: "wan27-videoedit-generation-2172", subject: "synthetic-owner"
});
export const WAN27_VIDEOEDIT_FIXTURE_OUTPUT_URL = "https://r2.syntx.ai/wan27-videoedit-generation-2172/output.mp4";
export const WAN27_VIDEOEDIT_FIXTURE_IMAGE_URL = "https://r2.syntx.ai/wan27-videoedit-generation-2172/reference.png";
export const WAN27_VIDEOEDIT_FIXTURE_VIDEO_URL = "https://r2.syntx.ai/wan27-videoedit-generation-2172/reference.mp4";

export interface Wan27VideoEditRuntimeFixtureOptions {
  readonly free?: boolean;
  readonly lowBalance?: boolean;
  readonly denied?: boolean;
  readonly staleSecondQuote?: boolean;
  readonly loseAck?: boolean;
  readonly initiallyPending?: boolean;
  readonly onGeneration?: (input: Readonly<{ chat_id: string; prompt: string; settings: unknown }>) => void;
}

export interface Wan27VideoEditRuntimeFixtureStats {
  uploadPosts: number;
  chatPosts: number;
  generationPosts: number;
  historyGets: number;
  resultGets: number;
  accessReads: number;
  accountReads: number;
  subscriptionReads: number;
  readonly quoteParameters: Readonly<Record<string, string>>[];
  lastSettings: unknown;
  lastPrompt: string;
}

export interface Wan27VideoEditRuntimeFixture {
  readonly attemptId: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly ffprobePath: string;
  readonly now: () => number;
  readonly stats: Wan27VideoEditRuntimeFixtureStats;
  readonly videoBytes: () => Buffer;
  createReadClient(): SyntxHttpClient;
  createChatClient(): SyntxChatHttpClient;
  advanceTime(milliseconds: number): void;
  setHistoryReady(ready: boolean): void;
  cleanup(): Promise<void>;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** Synthetic linked-owner HTTP/account fixture; no live network, host login, or provider access. */
export async function createWan27VideoEditRuntimeFixture(
  options: Wan27VideoEditRuntimeFixtureOptions = {}
): Promise<Wan27VideoEditRuntimeFixture> {
  let time = Date.parse("2026-10-17T00:00:00.000Z");
  const now = () => time;
  const advance = (milliseconds: number) => { time += milliseconds; };
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "wan27-videoedit-generation-2172", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-wan27-videoedit-generation-token" }); return { state: "LINKED" }; }
  };
  const linkService = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => WAN27_VIDEOEDIT_FIXTURE_ATTEMPT
  });
  await linkService.createAttempt(WAN27_VIDEOEDIT_FIXTURE_BINDING);
  await linkService.issueHandoff(WAN27_VIDEOEDIT_FIXTURE_BINDING, WAN27_VIDEOEDIT_FIXTURE_ATTEMPT);
  await linkService.checkAttempt(WAN27_VIDEOEDIT_FIXTURE_BINDING, WAN27_VIDEOEDIT_FIXTURE_ATTEMPT);

  const stats: Wan27VideoEditRuntimeFixtureStats = {
    uploadPosts: 0, chatPosts: 0, generationPosts: 0, historyGets: 0, resultGets: 0, accessReads: 0,
    accountReads: 0, subscriptionReads: 0, quoteParameters: [], lastSettings: undefined, lastPrompt: ""
  };
  const chatUuid = "88172";
  const ownerMessageId = "wan27-videoedit-owner-2172";
  const botMessageId = "wan27-videoedit-bot-2172";
  const resultObjectId = "wan27-videoedit-output-object-2172";
  let historyReady = !options.initiallyPending;
  const probeDirectory = await mkdtemp(join(tmpdir(), "syntx-wan27-videoedit-generation-2172-"));
  const interpreter = join(probeDirectory, "node");
  const probe = join(probeDirectory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const probeOutput = wan27VideoEditProbeFixture();
  await writeFile(probe, `#!${interpreter}\nprocess.stdout.write(${JSON.stringify(probeOutput)});\n`, { mode: 0o700, flag: "wx" });
  await chmod(probe, 0o700);
  const ffprobePath = realpathSync(probe);

  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (url.origin !== "https://api.syntx.ai") throw new Error("unexpected synthetic origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      stats.accountReads += 1;
      return json({ balance: options.lowBalance ? "0.01" : "10.00" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      stats.subscriptionReads += 1;
      return json({ active: true, type: options.free ? "FREE" : "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      stats.accessReads += 1;
      stats.quoteParameters.push(Object.freeze(Object.fromEntries([...url.searchParams.entries()].filter(([key]) =>
        key !== "ai_name" && key !== "model_type"))));
      return json({ access: !options.denied, cost: options.staleSecondQuote && stats.accessReads === 2 ? null : 0.2,
        discount_cost: null, free_remaining_generations: 100, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      stats.uploadPosts += 1;
      const form = init.body as FormData, file = form.get("files");
      if (!(file instanceof File)) throw new Error("synthetic upload did not contain a File");
      if (form.get("model_type") !== "wan_27_videoedit" || form.get("destination") !== "uploaded" ||
          form.get("check_duplicates") !== "true") throw new Error("synthetic upload tuple changed");
      const isVideo = file.type.startsWith("video/");
      return json({ files: [{ id: `wan27-videoedit-upload-${stats.uploadPosts}`,
        url: isVideo ? WAN27_VIDEOEDIT_FIXTURE_VIDEO_URL : WAN27_VIDEOEDIT_FIXTURE_IMAGE_URL,
        mime_type: file.type, size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      stats.chatPosts += 1;
      return json({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      stats.generationPosts += 1;
      if (url.searchParams.get("ai_name") !== "wan_video") throw new Error("unexpected WAN generation ai_name");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: unknown };
      if (body.chat_id !== chatUuid) throw new Error("unexpected synthetic chat binding");
      stats.lastSettings = body.settings;
      stats.lastPrompt = body.prompt;
      options.onGeneration?.(Object.freeze({ chat_id: body.chat_id, prompt: body.prompt, settings: body.settings }));
      if (options.loseAck) throw new Error("synthetic lost generation acknowledgement");
      return json({ id: ownerMessageId });
    }
    if (url.pathname === `/api/v1/chats/${chatUuid}/messages` && method === "GET") {
      stats.historyGets += 1;
      const settings = stats.lastSettings as { readonly file_urls?: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }>[] } | undefined;
      const inputObjects = (settings?.file_urls ?? []).map((file, index) => ({
        id: `wan27-videoedit-owner-input-${index + 1}-2172`, message_id: ownerMessageId,
        object_type: file.type, object_url: file.url, model_type: "wan_27_videoedit"
      }));
      const messages: unknown[] = [{ id: ownerMessageId, chat_id: chatUuid, author_id: 17, message_object: [
        { id: "wan27-videoedit-owner-text-2172", message_id: ownerMessageId, object_type: "text", object_text: stats.lastPrompt },
        ...inputObjects
      ] }];
      if (historyReady) messages.push({ id: botMessageId, chat_id: chatUuid, author_id: -1, message_object: [{ id: resultObjectId,
        message_id: botMessageId, object_type: "video", model_type: "wan_27_videoedit", completed: true,
        object_url: WAN27_VIDEOEDIT_FIXTURE_OUTPUT_URL }] });
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${chatUuid}/${botMessageId}` && method === "GET") {
      stats.resultGets += 1;
      return json({ id: botMessageId, chat_id: chatUuid, author_id: -1, message_object: [{ id: resultObjectId,
        message_id: botMessageId, object_type: "video", model_type: "wan_27_videoedit", completed: true,
        object_url: WAN27_VIDEOEDIT_FIXTURE_OUTPUT_URL }] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return linkService.useCredential(WAN27_VIDEOEDIT_FIXTURE_BINDING, WAN27_VIDEOEDIT_FIXTURE_ATTEMPT,
      credential => operation(credential.value));
  } };
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const createChatClient = () => new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  return {
    attemptId: WAN27_VIDEOEDIT_FIXTURE_ATTEMPT,
    binding: WAN27_VIDEOEDIT_FIXTURE_BINDING,
    linkService,
    ffprobePath,
    now,
    stats,
    videoBytes: () => minimalWan27Mp4Header(),
    createReadClient,
    createChatClient,
    advanceTime: advance,
    setHistoryReady(ready) { historyReady = ready; },
    async cleanup() { await rm(probeDirectory, { recursive: true, force: true }); }
  };
}
