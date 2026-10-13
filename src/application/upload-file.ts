import type { SyntxHttpClient, UploadFileReceipt } from "../adapter/syntx/http-client.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";

export interface UploadFileInput {
  content_base64: string;
  filename: string;
  mime_type: string;
  model_id: string;
}

export class UploadFileService {
  constructor(
    private readonly catalog: DiscoveryCatalogRepository,
    private readonly client: SyntxHttpClient
  ) {}

  async upload(input: UploadFileInput, signal?: AbortSignal): Promise<UploadFileReceipt> {
    const model = this.catalog.getModel(input.model_id);
    if (!model.active) throw new Error("MODEL_INACTIVE");
    const bytes = decodeBase64(input.content_base64);
    return this.client.uploadFile({
      bytes,
      filename: input.filename,
      mime_type: input.mime_type,
      model_type: model.upstream_id
    }, signal);
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) || value.length === 0) throw new Error("INVALID_BASE64");
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) throw new Error("INVALID_BASE64");
  return bytes;
}
