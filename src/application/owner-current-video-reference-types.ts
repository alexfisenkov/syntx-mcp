/** Internal ABI for source-reviewed current video references. No URL or provider ID is public. */
export type OwnerCurrentVideoReferenceModelId = "seedance-2.0" | "seedance-2.5" | "seedance_pro" | "seedance_pro-fast" | "seedance-1.5-pro" | "hailuo-3.0" | "ray-3.14" | "veo3" | "veo3fast" | "veo3fast_r" | "omni1.2" | "flux3_t2v" | "flux3_i2v" | "flux3_v2v" | "wan_25_t2v_preview" | "wan_25_i2v_preview" | "wan_27_i2v" | "wan_27_r2v" | "wan_27_videoedit" | "wan_30_t2v" | "wan_30_reference" | "wan_30_omni" | "wan_30_edit" | "wan_30_first_last_frame";
export type OwnerCurrentVideoReferenceKind = "image" | "video" | "audio" | "file";
export type OwnerCurrentVideoReferenceRole = OwnerCurrentVideoReferenceKind | "first_frame" | "last_frame" | "first_clip";
export interface OwnerCurrentVideoReferenceMetadata {
  readonly role: OwnerCurrentVideoReferenceRole;
  readonly kind: OwnerCurrentVideoReferenceKind;
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration_seconds?: number;
}
export interface OwnerCurrentVideoReferenceUploadReceipt extends Omit<OwnerCurrentVideoReferenceMetadata, "role"> {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly preparation: "ORIGINAL_BYTES" | "USER_SELECTED_SEGMENT_LOCAL_TRANSCODE";
  readonly expires_in_seconds: number;
}
declare const currentVideoReferenceBundleBrand: unique symbol;
export interface OwnerCurrentVideoReferenceBundle { readonly [currentVideoReferenceBundleBrand]: never; }
declare const currentVideoNativeUploadBrand: unique symbol;
export interface OwnerCurrentVideoNativeUpload { readonly [currentVideoNativeUploadBrand]: never; }
export interface OwnerCurrentVideoReferencePort {
  upload(input: {readonly attemptId:string; readonly model_id:OwnerCurrentVideoReferenceModelId; readonly filename:string;
    readonly mime_type:string; readonly content_base64:string;readonly trim?:Readonly<{start_seconds:number;end_seconds:number}>}, signal?:AbortSignal):Promise<OwnerCurrentVideoReferenceUploadReceipt>;
  prepare(input: {readonly attemptId:string;readonly model_id:OwnerCurrentVideoReferenceModelId;readonly mode:string;
    readonly references:readonly {readonly reference_handle:string;readonly role:OwnerCurrentVideoReferenceRole}[]},signal?:AbortSignal):Promise<Readonly<{
      bundle:OwnerCurrentVideoReferenceBundle;metadata:readonly Readonly<OwnerCurrentVideoReferenceMetadata>[] }>>;
  revalidate(bundle:OwnerCurrentVideoReferenceBundle,signal?:AbortSignal):Promise<void>;
  invalidateAttempt(attemptId:string):Promise<void>;
  close():Promise<void>;
}

export type OwnerCurrentVideoDispatchDiagnostic = Readonly<{ category: "HTTP_REJECTED" | "TRANSPORT_UNVERIFIED" | "ACK_UNVERIFIED"; http_status?: number }>;
declare const currentVideoNativeOperationBrand: unique symbol;
export interface OwnerCurrentVideoNativeOperation { readonly [currentVideoNativeOperationBrand]: never; }
export interface OwnerCurrentVideoNativePort<TIntent extends object = object> {
  createChat(input:{readonly attemptId:string;readonly bundle:OwnerCurrentVideoReferenceBundle;readonly intent:TIntent},signal?:AbortSignal):Promise<OwnerCurrentVideoNativeOperation>;
  dispatch(operation:OwnerCurrentVideoNativeOperation,signal?:AbortSignal):Promise<Readonly<{status:"acknowledged"}>>;
  observe(operation:OwnerCurrentVideoNativeOperation,signal?:AbortSignal):Promise<Readonly<{
    status:"pending"|"complete"|"unverified";diagnostic?:OwnerCurrentVideoDispatchDiagnostic;artifacts:readonly Readonly<{url:string;mime_type:string|null;message_id:string;message_object_id:string}>[]
  }>>;
  invalidateAttempt(attemptId:string):Promise<void>;
  close():Promise<void>;
}
