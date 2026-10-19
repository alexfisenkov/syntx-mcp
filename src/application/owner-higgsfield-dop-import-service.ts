import { types } from "node:util";
import {
  isOwnerHiggsfieldDopReferenceService,
  OwnerHiggsfieldDopReferenceService,
  type OwnerHiggsfieldDopExistingAssetImportInput,
  type OwnerHiggsfieldDopExistingAssetImportReceipt,
} from "./owner-higgsfield-dop-reference-service.js";

const SERVICES = new WeakSet<object>();

/** Narrow application entry point for importing, not uploading, one owned DOP account asset. */
export class OwnerHiggsfieldDopImportService {
  readonly #references: OwnerHiggsfieldDopReferenceService;

  constructor(referenceService: unknown) {
    if (!isOwnerHiggsfieldDopReferenceService(referenceService) ||
        typeof Reflect.get(OwnerHiggsfieldDopReferenceService.prototype, "importExistingReference") !== "function") {
      throw new Error("INVALID_OWNER_HIGGSFIELD_DOP_IMPORT_SERVICE");
    }
    this.#references = referenceService;
    SERVICES.add(this);
    Object.freeze(this);
  }

  importExisting(input: OwnerHiggsfieldDopExistingAssetImportInput | unknown,
    signal?: AbortSignal): Promise<OwnerHiggsfieldDopExistingAssetImportReceipt> {
    if (signal !== undefined && (!signal || typeof signal !== "object" || types.isProxy(signal) ||
        !(signal instanceof AbortSignal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype)) {
      return Promise.reject(new Error("INVALID_REQUEST"));
    }
    return this.#references.importExistingReference(input, signal);
  }
}

Object.freeze(OwnerHiggsfieldDopImportService.prototype);

export function isOwnerHiggsfieldDopImportService(value: unknown): value is OwnerHiggsfieldDopImportService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHiggsfieldDopImportService.prototype && Object.isFrozen(value);
}
