import type {
  ListUploadedFilesRequest,
  SyntxHttpClient,
  SyntxUploadedFiles
} from "../adapter/syntx/http-client.js";

export type UploadedFileReconciliationStatus =
  | "FOUND"
  | "NOT_FOUND"
  | "SEARCH_INCOMPLETE";

export interface ReconcileUploadedFileRequest {
  file_id: string;
}

export interface ReconcileUploadedFileResult {
  status: UploadedFileReconciliationStatus;
  file_id: string;
  metadata: {
    mime_type?: string;
    size?: number;
    created_at?: string;
  };
}

/** Read-only owner file metadata; URLs and storage handles never leave the client. */
export class UploadedFilesService {
  constructor(private readonly client: SyntxHttpClient) {}

  async listUploadedFiles(
    request: ListUploadedFilesRequest,
    signal?: AbortSignal
  ): Promise<SyntxUploadedFiles> {
    return this.client.listUploadedFiles(request, signal);
  }

  /**
   * Read-only bounded reconciliation. It intentionally searches a fixed
   * first confirmed page of the account inventory using the endpoint's
   * confirmed page size and never uses storage handles or URLs. A true
   * `has_more` is reported as SEARCH_INCOMPLETE rather than guessing that
   * later pages share the same wire contract.
   */
  async reconcileUploadedFile(
    request: ReconcileUploadedFileRequest,
    signal?: AbortSignal
  ): Promise<ReconcileUploadedFileResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(request.file_id)) {
      throw new Error("INVALID_FILE_ID");
    }
    for (let page = 1; page <= 1; page += 1) {
      const result = await this.client.listUploadedFiles(
        { scope: "all", page, page_size: 10 },
        signal
      );
      const match = result.items.find((item) => item.id === request.file_id);
      if (match) {
        return {
          status: "FOUND",
          file_id: request.file_id,
          metadata: {
            ...(match.mime_type === undefined ? {} : { mime_type: match.mime_type }),
            ...(match.size === undefined ? {} : { size: match.size }),
            ...(match.created_at === undefined ? {} : { created_at: match.created_at })
          }
        };
      }
      if (!result.has_more) {
        return { status: "NOT_FOUND", file_id: request.file_id, metadata: {} };
      }
      return { status: "SEARCH_INCOMPLETE", file_id: request.file_id, metadata: {} };
    }
    return {
      status: "SEARCH_INCOMPLETE",
      file_id: request.file_id,
      metadata: {}
    };
  }
}
