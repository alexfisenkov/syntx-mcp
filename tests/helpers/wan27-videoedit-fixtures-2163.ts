/** Small local MP4/MOV header and deterministic ffprobe JSON fixtures; no media is copied from a user or provider. */
export function minimalWan27Mp4Header(majorBrand: "isom" | "qt  " = "isom"): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(majorBrand, 8, "ascii");
  bytes.writeUInt32BE(0, 12);
  bytes.write(majorBrand, 16, "ascii");
  bytes.write(majorBrand === "qt  " ? "qt  " : "mp41", 20, "ascii");
  return bytes;
}

export interface Wan27VideoEditProbeStreamFixture {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly start_time?: string;
  readonly start_pts?: number | string;
  readonly duration?: string;
  readonly duration_ts?: number | string;
  readonly time_base?: string;
  readonly disposition?: Readonly<{ attached_pic: number }>;
  readonly color_transfer?: string;
}

export interface Wan27VideoEditProbeFixtureOverrides {
  readonly streams?: readonly Wan27VideoEditProbeStreamFixture[];
  readonly format_name?: string;
  readonly format_duration?: string;
}

export const WAN27_VIDEOEDIT_PROBE_STREAMS: readonly Wan27VideoEditProbeStreamFixture[] = Object.freeze([
  Object.freeze({ codec_type: "video", codec_name: "mpeg4", width: 320, height: 240, start_time: "0.250000", start_pts: 250,
    duration: "2.500000", duration_ts: 2500, time_base: "1/1000", disposition: Object.freeze({ attached_pic: 0 }) }),
  Object.freeze({ codec_type: "audio", codec_name: "aac", start_time: "0.500000", start_pts: 500,
    duration: "3.750000", duration_ts: 3750, time_base: "1/1000" })
]);

/** Video ends at 2.75s, audio at 4.25s; format.duration is intentionally longer and must not win. */
export function wan27VideoEditProbeFixture(overrides: Wan27VideoEditProbeFixtureOverrides = {}): string {
  return JSON.stringify({
    streams: overrides.streams ?? WAN27_VIDEOEDIT_PROBE_STREAMS,
    format: { format_name: overrides.format_name ?? "mov,mp4,m4a,3gp,3g2,mj2", duration: overrides.format_duration ?? "99.000000" }
  });
}
