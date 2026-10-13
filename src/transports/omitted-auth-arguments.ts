import type {
  JSONRPCMessage,
  MessageExtraInfo
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions
} from "@modelcontextprotocol/sdk/shared/transport.js";

const AUTH_TOOLS_REQUIRING_ARGUMENTS = new Set([
  "syntx_check_login",
  "syntx_unlink"
]);

/**
 * Decorate a public MCP Transport so clients that truly omit `arguments` get
 * the same safe auth-tool error as clients that send an empty object.
 *
 * This compatibility shim is intentionally narrower than schema coercion. It
 * does not rewrite explicit null/array/string/undefined values, other tools,
 * or any request other than tools/call.
 */
export function withOmittedAuthArguments(
  transport: Transport
): Transport {
  const decorated = new OmittedAuthArgumentsTransport(transport);
  if ("sessionId" in transport) {
    Object.defineProperty(decorated, "sessionId", {
      configurable: false,
      enumerable: true,
      get: () => transport.sessionId
    });
  }
  if (transport.setProtocolVersion !== undefined) {
    decorated.setProtocolVersion = (version) => {
      transport.setProtocolVersion?.(version);
    };
  }
  return decorated;
}

/** Exported for a transport-boundary regression test; it is pure and lossless. */
export function normalizeOmittedAuthArguments(
  message: JSONRPCMessage
): JSONRPCMessage {
  if (!("method" in message) || message.method !== "tools/call") {
    return message;
  }

  const params = message.params;
  if (!isPlainRecord(params)) return message;
  if (
    typeof params.name !== "string" ||
    !AUTH_TOOLS_REQUIRING_ARGUMENTS.has(params.name) ||
    Object.hasOwn(params, "arguments")
  ) {
    return message;
  }

  return {
    ...message,
    params: {
      ...params,
      arguments: {}
    }
  } as JSONRPCMessage;
}

class OmittedAuthArgumentsTransport implements Transport {
  readonly #transport: Transport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: MessageExtraInfo
  ) => void;
  setProtocolVersion?: (version: string) => void;

  constructor(transport: Transport) {
    this.#transport = transport;
    const originalOnClose = transport.onclose;
    const originalOnError = transport.onerror;
    const originalOnMessage = transport.onmessage;

    this.#transport.onclose = () => {
      originalOnClose?.();
      this.onclose?.();
    };
    this.#transport.onerror = (error) => {
      originalOnError?.(error);
      this.onerror?.(error);
    };
    this.#transport.onmessage = <T extends JSONRPCMessage>(
      message: T,
      extra?: MessageExtraInfo
    ) => {
      originalOnMessage?.(message, extra);
      this.onmessage?.(normalizeOmittedAuthArguments(message), extra);
    };
  }

  async start(): Promise<void> {
    await this.#transport.start();
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions
  ): Promise<void> {
    await this.#transport.send(message, options);
  }

  async close(): Promise<void> {
    await this.#transport.close();
  }

}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
