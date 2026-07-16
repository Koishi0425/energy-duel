const HASHED_PUBLIC_ASSET = /\.[a-f0-9]{12}\.[^.]+$/i;
const VITE_BUNDLE = /\/[\w.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

export function staticCacheControlForPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized.endsWith('/index.html') || normalized.includes('/assets/manifests/')) return 'no-cache';
  if (HASHED_PUBLIC_ASSET.test(normalized) || VITE_BUNDLE.test(normalized)) return 'public, max-age=31536000, immutable';
  if (normalized.includes('/assets/')) return 'public, max-age=3600';
  return 'no-cache';
}
