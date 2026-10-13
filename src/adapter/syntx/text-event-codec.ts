export type TextEventTerminal = "open" | "done" | "complete" | "cancelled" | "error" | "unknown";
export type TextEventFailureCode = "INVALID_UTF8" | "INVALID_EVENT" | "RESOURCE_LIMIT" | "UPSTREAM_ERROR" | null;

export interface TextEventCodecSnapshot {
  text: string;
  terminal: TextEventTerminal;
  failureCode: TextEventFailureCode;
  eventCount: number;
}

export interface TextEventCodec {
  feed(chunk: Uint8Array): void;
  end(): void;
  snapshot(): TextEventCodecSnapshot;
}

export function createTextEventCodec(): TextEventCodec {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  const seenMessageUuids = new Set<string>();
  let suffix = "";
  let text = "";
  let terminal: TextEventTerminal = "open";
  let failureCode: TextEventFailureCode = null;
  let eventCount = 0;
  let totalBytes = 0;
  let ended = false;

  const fail = (code: Exclude<TextEventFailureCode, null>) => {
    terminal = "error";
    failureCode = code;
    suffix = "";
  };

  const inspectJson = (value: unknown): boolean => {
    const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!item || item.depth > 32) return false;
      if (item.value === null || typeof item.value !== "object") continue;
      if (Array.isArray(item.value)) {
        for (const entry of item.value) stack.push({ value: entry, depth: item.depth + 1 });
      } else {
        for (const [key, entry] of Object.entries(item.value)) {
          if (key === "__proto__" || key === "prototype" || key === "constructor") return false;
          stack.push({ value: entry, depth: item.depth + 1 });
        }
      }
    }
    return true;
  };

  const consumeEvent = (raw: string) => {
    if (terminal !== "open") return;
    if (raw === "[DONE]") {
      terminal = "done";
      return;
    }
    eventCount += 1;
    if (eventCount > 4096) return fail("RESOURCE_LIMIT");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail("INVALID_EVENT");
    }
    if (!inspectJson(parsed)) return fail("INVALID_EVENT");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const event = parsed as Record<string, unknown>;
    const choices = event.choices;
    let normalized: Record<string, unknown> = event;
    let finishReason: unknown;
    if (Array.isArray(choices) && choices.length > 0 && choices[0] !== null && typeof choices[0] === "object" && !Array.isArray(choices[0])) {
      const choice = choices[0] as Record<string, unknown>;
      finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (delta !== null && typeof delta === "object" && !Array.isArray(delta)) {
        normalized = { ...event, ...(delta as Record<string, unknown>) };
      }
    }

    let type = typeof normalized.type === "string" ? normalized.type : undefined;
    if (finishReason === "stop" && type === undefined) type = "complete";
    if (type === "complete") {
      terminal = "complete";
      return;
    }
    if (type === "cancelled") {
      terminal = "cancelled";
      return;
    }
    if (type === "error") {
      terminal = "error";
      failureCode = "UPSTREAM_ERROR";
      return;
    }
    if (type !== "content" && type !== "chunk") return;

    const content = normalized.content;
    if (typeof content !== "string") return;
    const uuid = normalized.message_uuid;
    if (typeof uuid === "string" && uuid.length > 0) {
      if (seenMessageUuids.has(uuid)) return;
      if (seenMessageUuids.size >= 4096) return fail("RESOURCE_LIMIT");
      seenMessageUuids.add(uuid);
    }
    if (encoder.encode(text + content).byteLength > 1024 * 1024) return fail("RESOURCE_LIMIT");
    text += content;
  };

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith(":")) return;
    if (line.startsWith("id: ")) return;
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6);
    if (encoder.encode(data).byteLength > 64 * 1024) return fail("RESOURCE_LIMIT");
    consumeEvent(data);
  };

  return {
    feed(chunk) {
      if (ended || terminal !== "open") return;
      totalBytes += chunk.byteLength;
      if (totalBytes > 2 * 1024 * 1024) return fail("RESOURCE_LIMIT");
      let decoded: string;
      try {
        decoded = decoder.decode(chunk, { stream: true });
      } catch {
        return fail("INVALID_UTF8");
      }
      const lines = (suffix + decoded).split("\n");
      suffix = lines.pop() ?? "";
      for (const line of lines) {
        if (encoder.encode(line).byteLength > 64 * 1024) return fail("RESOURCE_LIMIT");
        consumeLine(line);
        if (terminal !== "open") break;
      }
      if (terminal === "open" && encoder.encode(suffix).byteLength > 64 * 1024) fail("RESOURCE_LIMIT");
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        suffix += decoder.decode();
      } catch {
        fail("INVALID_UTF8");
        return;
      }
      if (encoder.encode(suffix).byteLength > 64 * 1024) {
        fail("RESOURCE_LIMIT");
        return;
      }
      if (terminal === "open") terminal = "unknown";
    },
    snapshot() {
      return { text, terminal, failureCode, eventCount };
    }
  };
}
