import { writeFileSync } from "node:fs";

const STATE_PATH = process.env.SYNTX_WAN25_1691_STATE_FILE;
const AUTH_UUID = "00000000-0000-4000-8000-000000001691";
const TOKEN = "synthetic-stdio-owner-token-1691";
const CHAT_ID = "wan25-stdio-chat";
const OWNER_ACK = "wan25-stdio-ack";
const VIDEO_MESSAGE = "wan25-stdio-video-message";
const VIDEO_OBJECT = "wan25-stdio-video-object";
const IMAGE_URL = "https://r2.syntx.ai/wan25/stdio-owned-image.png";
const HISTORY_VIDEO_URL = "https://r2.syntx.ai/wan25/stdio-history-video.mp4";
const RESULT_URL = "https://r2.syntx.ai/wan25/stdio-result.mp4";
const MODEL_ID = "wan_25_i2v_preview";
const counts = { auth_start: 0, auth_token: 0, balance: 0, subscription: 0, quote: 0,
  upload: 0, chat_create: 0, generation: 0, history: 0, result: 0, denied: 0 };
let promptText: string | undefined;

function deepInertMetadata(): unknown {
  let value: unknown = "synthetic-inert-metadata";
  for (let index = 0; index < 12; index += 1) value = { nested: value };
  return value;
}

function persist(): void {
  if (STATE_PATH) writeFileSync(STATE_PATH, JSON.stringify(counts), { mode: 0o600 });
}
function rejectRoute(): never { counts.denied += 1; persist(); throw new Error("WAN25_STDIO_SYNTHETIC_FETCH_DENIED"); }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

globalThis.fetch = async (input, init = {}) => {
  let url: URL;
  try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { return rejectRoute(); }
  const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.origin !== "https://api.syntx.ai" || url.username || url.password || url.hash) return rejectRoute();
  const json = (value: unknown) => Response.json(value);
  if (url.pathname === "/api/v1/auth/startauth" && method === "POST" && !url.search && counts.auth_start === 0) {
    counts.auth_start += 1; persist(); return json({ uuid: AUTH_UUID });
  }
  if (url.pathname === `/api/v1/auth/token/${AUTH_UUID}` && method === "GET" && !url.search && counts.auth_token < 7) {
    counts.auth_token += 1; persist(); return json({ valid: true, complete: true, token: TOKEN, is_new_user: false });
  }
  if (url.pathname === "/api/v1/user/balance" && method === "GET" && !url.search && counts.balance < 4) {
    counts.balance += 1; persist(); return json({ balance: "920.5" });
  }
  if (url.pathname === "/api/v1/user/subscription" && method === "GET" && url.search === "?ref=false" && counts.subscription < 4) {
    counts.subscription += 1; persist(); return json({ active: true, type: "PRO", end_date: new Date(Date.now() + 3_600_000).toISOString() });
  }
  if (url.pathname === "/api/v2/get_model_info" && method === "GET" && counts.quote < 4) {
    const keys = [...url.searchParams.keys()].sort().join(",");
    if (keys !== "ai_name,model_type,resolution,video_duration" || url.searchParams.get("ai_name") !== "wan_video" ||
        url.searchParams.get("model_type") !== MODEL_ID || url.searchParams.get("video_duration") !== "5") return rejectRoute();
    counts.quote += 1; persist(); return json({ access: true, cost: 7.5, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
  }
  if (url.pathname === "/api/v1/chats/upload-files" && method === "POST" && !url.search && counts.upload === 0) {
    const form = init.body;
    if (!(form instanceof FormData) || form.get("destination") !== "uploaded" || form.get("check_duplicates") !== "true" ||
        form.get("model_type") !== MODEL_ID) return rejectRoute();
    const file = form.get("files");
    if (!(file instanceof File) || file.type !== "image/png" || file.name !== "stdio-preview.png") return rejectRoute();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pngOk = bytes.length >= 29 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16) === 384 &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20) === 384;
    bytes.fill(0);
    if (!pngOk) return rejectRoute();
    counts.upload += 1; persist(); return json({ files: [{ id: "stdio-preview-upload", url: IMAGE_URL, filename: file.name,
      mime_type: file.type, content_type: file.type, media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
  }
  if (url.pathname === "/api/v1/chats" && method === "POST" && !url.search && counts.chat_create === 0) {
    let body: unknown; try { body = JSON.parse(String(init.body)); } catch { return rejectRoute(); }
    if (!isObject(body) || body.scope !== "video" || typeof body.title !== "string" || !/^owner-wan25-i2v-/u.test(body.title) ||
        Object.keys(body).sort().join(",") !== "scope,title") return rejectRoute();
    counts.chat_create += 1; persist(); return json({ uuid: CHAT_ID });
  }
  if (url.pathname === "/api/v1/video/generate" && method === "POST" && url.search === "?ai_name=wan_video" && counts.generation === 0) {
    let body: unknown; try { body = JSON.parse(String(init.body)); } catch { return rejectRoute(); }
    if (!isObject(body) || body.chat_id !== CHAT_ID || typeof body.prompt !== "string" || !isObject(body.settings) ||
        Object.keys(body).sort().join(",") !== "chat_id,prompt,settings") return rejectRoute();
    const settings = body.settings;
    const names = Object.keys(settings).sort().join(",");
    if (names !== "aspect_ratio,audio_setting,file_urls,model_type,native_audio,prompt_extend,resolution,seed,shot_type,video_duration" ||
        settings.model_type !== MODEL_ID || settings.native_audio !== false || settings.shot_type !== "single" ||
        settings.audio_setting !== "auto" || settings.resolution !== "720P" || settings.aspect_ratio !== "16:9" ||
        settings.video_duration !== 5 || settings.prompt_extend !== false || settings.seed !== null || !Array.isArray(settings.file_urls) ||
        settings.file_urls.length !== 1 || !isObject(settings.file_urls[0]) || settings.file_urls[0].type !== "image" ||
        settings.file_urls[0].url !== IMAGE_URL || Object.hasOwn(settings, "duration")) return rejectRoute();
    promptText = body.prompt;
    counts.generation += 1; persist(); return json({ id: OWNER_ACK });
  }
  const historyPath = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
  if (historyPath && decodeURIComponent(historyPath[1]!) === CHAT_ID && method === "GET" &&
      url.search === "?page=1&page_size=10" && counts.history < 12) {
    counts.history += 1; persist();
    return json({ messages: [
      { id: OWNER_ACK, chat_id: 529, author_id: 11, created_at: "2026-10-15T00:00:00Z",
        message_object: [{ id: "stdio-preview-owner-text", message_id: OWNER_ACK, object_type: "text", model_type: MODEL_ID, object_text: promptText }] },
      { id: VIDEO_MESSAGE, chat_id: 529, author_id: -1, created_at: "2026-10-15T00:00:00Z",
        message_object: [{ id: VIDEO_OBJECT, message_id: VIDEO_MESSAGE, object_type: "video", model_type: MODEL_ID, completed: true,
          object_url: HISTORY_VIDEO_URL, created_at: "2026-10-15T00:00:00Z", task_id: "synthetic-preview-task", metadata: deepInertMetadata() }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false,
      next: null, next_cursor: null, prev_cursor: 1 }, created_at: "2026-10-15T00:00:00Z",
      chat_limits: { opaque_limit: 10 }, context: { opaque_context: { nested: true } } });
  }
  const resultPath = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (resultPath && decodeURIComponent(resultPath[1]!) === CHAT_ID && decodeURIComponent(resultPath[2]!) === VIDEO_MESSAGE &&
      method === "GET" && !url.search && counts.result < 12) {
    counts.result += 1; persist(); return json({ id: VIDEO_MESSAGE, chat_id: 529, author_id: -1, message_object: [
      { id: VIDEO_OBJECT, message_id: VIDEO_MESSAGE, object_type: "video", model_type: MODEL_ID, completed: true,
        object_url: RESULT_URL, metadata: deepInertMetadata() }
    ] });
  }
  return rejectRoute();
};

persist();
