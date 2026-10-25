import { createVideoPlayer, type SourceLoadEventPayload } from 'expo-video';

export type CameraMetadata = { resolution?: string; fps?: number; videoDurationMs: number | null;
  metadataSource: 'expo-video' | 'unavailable'; codec?: string; width?: number; height?: number };
/** Inspect the completed file, never substitute requested 720p/30fps for measurements. */
export async function inspectRecording(uri: string): Promise<CameraMetadata> {
  const player = createVideoPlayer(null);
  let subscription: { remove(): void } | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = new Promise<SourceLoadEventPayload | null>(resolve => {
      subscription = player.addListener('sourceLoad', resolve);
      timeout = setTimeout(() => resolve(null), 3000);
    });
    void player.replaceAsync(uri).catch(() => {});
    const result = await loaded;
    if (!result) return { videoDurationMs: null, metadataSource: 'unavailable' };
    const track = result.availableVideoTracks[0], width = track?.size.width, height = track?.size.height;
    return { metadataSource: 'expo-video', videoDurationMs: result.duration > 0 ? result.duration * 1000 : null,
      ...(track?.mimeType ? { codec: track.mimeType } : {}),
      ...(width && height ? { width, height, resolution: `${width}x${height}` } : {}),
      ...(track?.frameRate && track.frameRate > 0 ? { fps: track.frameRate } : {}) };
  } finally { clearTimeout(timeout); subscription?.remove(); player.release(); }
}
