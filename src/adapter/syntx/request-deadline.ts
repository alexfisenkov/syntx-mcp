export type RequestAbortSource = "external" | "timeout";

/**
 * One absolute deadline for the complete adapter operation, including
 * credential-broker wait, fetch and response-body reads.
 */
export class AbsoluteRequestDeadline {
  readonly #controller = new AbortController();
  readonly #abortPromise: Promise<never>;
  readonly #timeout: ReturnType<typeof setTimeout>;
  readonly #externalSignal: AbortSignal | undefined;
  readonly #abortFromExternal: () => void;
  readonly #makeError: (source: RequestAbortSource) => Error;
  #abortSource: RequestAbortSource | null = null;

  constructor(
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
    makeError: (source: RequestAbortSource) => Error
  ) {
    this.#externalSignal = externalSignal;
    this.#makeError = makeError;

    let rejectAbort: (error: Error) => void = () => undefined;
    this.#abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    // A pre-aborted signal can reject before waitFor() attaches its race.
    void this.#abortPromise.catch(() => undefined);

    const abortWith = (source: RequestAbortSource) => {
      if (this.#abortSource !== null) return;
      this.#abortSource = source;
      this.#controller.abort();
      rejectAbort(this.#makeError(source));
    };
    this.#abortFromExternal = () => abortWith("external");
    externalSignal?.addEventListener("abort", this.#abortFromExternal, {
      once: true
    });
    if (externalSignal?.aborted) this.#abortFromExternal();
    this.#timeout = setTimeout(() => abortWith("timeout"), timeoutMs);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get abortSource(): RequestAbortSource | null {
    return this.#abortSource;
  }

  throwIfAborted(): void {
    if (this.#abortSource !== null) {
      throw this.#makeError(this.#abortSource);
    }
  }

  async waitFor<T>(operation: Promise<T>): Promise<T> {
    // The deadline may already have fired between operation construction and
    // this call. Keep a rejection observer attached to late broker/fetch work.
    void operation.catch(() => undefined);
    this.throwIfAborted();
    return Promise.race([operation, this.#abortPromise]);
  }

  close(): void {
    clearTimeout(this.#timeout);
    this.#externalSignal?.removeEventListener(
      "abort",
      this.#abortFromExternal
    );
  }
}
