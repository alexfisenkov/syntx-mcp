import { randomUUID } from "node:crypto";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";

export const OWNER_ELEVENLABS_VOICE_FILTERS = ["search", "gender", "age", "use_case", "accent", "language", "sort_by", "sort_direction"] as const;
export const OWNER_ELEVENLABS_VOICE_CURSOR = /^owner_elevenlabs_cursor_[0-9a-f-]{36}$/u;
export interface OwnerElevenLabsVoiceQuery {
  readonly page: number;
  readonly page_size: 10 | 20;
  readonly search?: string;
  readonly gender?: string;
  readonly age?: string;
  readonly use_case?: string;
  readonly accent?: string;
  readonly language?: string;
  readonly sort_by?: string;
  readonly sort_direction?: string;
}
export interface OwnerElevenLabsVoiceDiscoveryInput {
  readonly page?: 1;
  readonly page_size?: 10 | 20;
  readonly cursor?: string;
  readonly search?: string;
  readonly gender?: string;
  readonly age?: string;
  readonly use_case?: string;
  readonly accent?: string;
  readonly language?: string;
  readonly sort_by?: string;
  readonly sort_direction?: string;
}
export function normalizeOwnerElevenLabsVoiceDiscovery(fields: Record<string, unknown>): OwnerElevenLabsVoiceDiscoveryInput {
  if (fields.cursor !== undefined) {
    if (typeof fields.cursor !== "string" || !OWNER_ELEVENLABS_VOICE_CURSOR.test(fields.cursor) ||
        ["page", "page_size", ...OWNER_ELEVENLABS_VOICE_FILTERS].some((key) => fields[key] !== undefined)) throw new Error("INVALID_VOICE_DISCOVERY");
    return Object.freeze({ cursor: fields.cursor });
  }
  if (fields.page !== undefined && fields.page !== 1 || fields.page_size !== undefined && fields.page_size !== 10 && fields.page_size !== 20) throw new Error("INVALID_VOICE_DISCOVERY");
  const filters: Record<string, string> = {};
  for (const key of OWNER_ELEVENLABS_VOICE_FILTERS) {
    const value = fields[key]; if (value === undefined) continue;
    if (typeof value !== "string" || value.length > (key === "search" ? 500 : 256) || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("INVALID_VOICE_DISCOVERY");
    if (value.trim().length) filters[key] = value;
  }
  return Object.freeze({ page: 1, page_size: fields.page_size === 20 ? 20 : 10, ...filters });
}

interface CursorRecord {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly epoch: number;
  readonly expires: number;
  readonly query: OwnerElevenLabsVoiceQuery;
  readonly key: string;
}
/** Process-local opaque pointers to captured query state. A cursor never selects another account or arbitrary URL. */
export class OwnerElevenLabsVoiceDiscoveryCursors {
  readonly #records = new Map<string, CursorRecord>();
  readonly #keys = new Map<string, string>();
  resolve(cursor: string, principal: Readonly<GenerationPrincipalRef>, epoch: number, now: number): OwnerElevenLabsVoiceQuery | undefined {
    this.#prune(now); const record = this.#records.get(cursor);
    return record && record.epoch === epoch && sameGenerationPrincipal(record.principal, principal) ? record.query : undefined;
  }
  next(query: OwnerElevenLabsVoiceQuery, total: number | null, principal: Readonly<GenerationPrincipalRef>, epoch: number, now: number): string | null {
    this.#prune(now);
    if (total === null || query.page * query.page_size >= total || query.page >= 1000) return null;
    const nextQuery = Object.freeze({ ...query, page: query.page + 1 });
    const key = JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id, epoch, nextQuery]);
    const existing = this.#keys.get(key); if (existing && this.#records.has(existing)) return existing;
    if (this.#records.size >= 128) throw new Error("VOICE_CURSOR_CAPACITY");
    const cursor = `owner_elevenlabs_cursor_${randomUUID()}`;
    this.#records.set(cursor, { principal, epoch, expires: now + 15 * 60_000, query: nextQuery, key }); this.#keys.set(key, cursor);
    return cursor;
  }
  invalidateAttempt(attemptId: string): void {
    for (const [id, record] of this.#records) if (record.principal.connection_id === attemptId) this.#drop(id, record);
  }
  clear(): void { this.#records.clear(); this.#keys.clear(); }
  #drop(id: string, record: CursorRecord): void { this.#records.delete(id); if (this.#keys.get(record.key) === id) this.#keys.delete(record.key); }
  #prune(now: number): void { for (const [id, record] of this.#records) if (record.expires <= now) this.#drop(id, record); }
}
