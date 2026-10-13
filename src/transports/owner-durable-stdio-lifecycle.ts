import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Readable } from "node:stream";

/** Close a durable owner manager once, and observe asynchronous cleanup on EOF or transport close. */
export function closeOwnerDurableSessionOnTransportEof(
  transport: Transport,
  closeManager: () => Promise<void>,
  input: Readable = process.stdin
): () => Promise<void> {
  const originalOnClose = transport.onclose;
  let closePromise: Promise<void> | undefined;
  let closeRequested = false;
  const closeOnce = (): Promise<void> => {
    input.off("end", onInputEnd);
    if (closePromise !== undefined) return closePromise;
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    try { Promise.resolve(closeManager()).then(resolveClose, rejectClose); }
    catch (error) { rejectClose(error); }
    return closePromise;
  };
  const reportFailure = (): void => { process.exitCode = 1; };
  const onInputEnd = (): void => {
    if (closeRequested) return;
    closeRequested = true;
    const managerClose = closeOnce();
    void managerClose.catch(reportFailure);
    void (async () => {
      try { await transport.close(); } catch { reportFailure(); }
      try { await managerClose; } catch { reportFailure(); }
    })().catch(reportFailure);
  };

  input.on("end", onInputEnd);
  transport.onclose = () => {
    try { originalOnClose?.(); } catch { reportFailure(); }
    void closeOnce().catch(reportFailure);
  };
  return closeOnce;
}
