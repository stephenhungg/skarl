/** Reuse an already issued bearer URL; never turn this endpoint into an arbitrary fetch proxy. */
export function replayStorageUrl(input: string, convexUrl: string): URL {
  const allowed = new URL(convexUrl);
  const url = new URL(input);
  if (allowed.protocol !== "https:" || url.origin !== allowed.origin || url.username || url.password ||
    url.search || url.hash || !/^\/api\/storage\/[a-zA-Z0-9-]+$/.test(url.pathname)) {
    throw new Error("invalid_media_url");
  }
  return url;
}

export function replayProxyUrl(storageUrl: string): string {
  return `/api/replay/media?url=${encodeURIComponent(storageUrl)}`;
}
