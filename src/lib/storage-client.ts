export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-") || "file";
}

export type ImageVariantWidth = 96 | 320 | 800;
export type StorageAttachmentContext = {
  type: "budget_line" | "grant_application";
  id: string;
};

type PendingUrlRequest = {
  key: string;
  imageWidth?: ImageVariantWidth;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
};

type CachedUrl = { url: string; expiresAt: number };

const URL_CACHE_STORAGE_KEY = "label-suite:storage-url-cache";
const URL_EXPIRY_BUFFER_MS = 30_000;
const memoryUrlCache = new Map<string, CachedUrl>();
let pendingUrlRequests: PendingUrlRequest[] = [];
let flushScheduled = false;

export async function uploadFileToStorage(file: File, folder: string, context?: StorageAttachmentContext) {
  const safeName = sanitizeFilename(file.name);
  const key = `${folder}/${Date.now()}-${safeName}`;

  if (context) return uploadFileThroughServer(file, key, context);

  const signedUploadRes = await fetch("/api/storage/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType: file.type || "application/octet-stream", size: file.size }),
  });

  if (signedUploadRes.ok) {
    const signedUpload = await signedUploadRes.json() as {
      key: string;
      url?: string | null;
      uploadUrl: string;
      requiredHeaders?: Record<string, string>;
    };

    try {
      const uploadRes = await fetch(signedUpload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(signedUpload.requiredHeaders ?? {}),
        },
        body: file,
      });

      if (uploadRes.ok) {
        await optimizeUploadedImage(file, signedUpload.key);
        return {
          key: signedUpload.key,
          url: signedUpload.url ?? null,
        };
      }
    } catch {
      // A bucket without browser CORS cannot complete a direct upload. Keep the
      // server upload as a compatibility path while production CORS is rolled out.
    }
  }

  return uploadFileThroughServer(file, key);
}

async function uploadFileThroughServer(file: File, key: string, context?: StorageAttachmentContext) {
  const form = new FormData();
  if (context) form.set("context", JSON.stringify(context));
  else form.set("key", key);
  form.set("file", file);

  const uploadRes = await fetch("/api/storage/upload", {
    method: "POST",
    body: form,
  });

  if (!uploadRes.ok) {
    const data = await uploadRes.json().catch(() => ({}));
    throw new Error(data.error || "File upload failed");
  }

  const uploaded = await uploadRes.json() as { key: string; url?: string | null };

  await optimizeUploadedImage(file, uploaded.key, context);

  return {
    key: uploaded.key,
    url: uploaded.url ?? null,
  };
}

export async function resolveFileUrl(fileLink: string, imageWidth?: ImageVariantWidth) {
  if (/^https?:\/\//i.test(fileLink)) {
    return fileLink;
  }

  const key = storageUrlCacheKey(fileLink, imageWidth);
  const cached = getCachedUrl(key);
  if (cached) return cached;

  return new Promise<string>((resolve, reject) => {
    pendingUrlRequests.push({ key: fileLink, imageWidth, resolve, reject });
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushPendingUrlRequests);
    }
  });
}

export function isImageAsset(assetType?: string | null, fileLink?: string | null) {
  const type = (assetType || "").toLowerCase();
  const link = (fileLink || "").toLowerCase();
  return type.includes("cover") || type.includes("photo") || /\.(png|jpe?g|webp|gif|avif|svg)$/.test(link);
}

async function optimizeUploadedImage(file: File, key: string, context?: StorageAttachmentContext): Promise<void> {
  if (!isOptimizableImage(file)) return;

  try {
    await fetch("/api/storage/optimize-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context ? { key, context } : { key }),
    });
  } catch {
    // The original upload is still valid. Rendering falls back to it whenever
    // optimization is temporarily unavailable.
  }
}

function isOptimizableImage(file: File): boolean {
  return /^(?:image\/(?:avif|jpeg|png|webp))$/i.test(file.type)
    || /\.(?:avif|jpe?g|png|webp)$/i.test(file.name);
}

async function flushPendingUrlRequests(): Promise<void> {
  flushScheduled = false;
  const requests = pendingUrlRequests;
  pendingUrlRequests = [];

  for (let offset = 0; offset < requests.length; offset += 100) {
    const batch = requests.slice(offset, offset + 100);
    try {
      const response = await fetch("/api/storage/download-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batch.map(({ key, imageWidth }) => ({ key, imageWidth })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        expiresAt?: number;
        items?: Array<{ key: string; imageWidth?: ImageVariantWidth; url: string }>;
      };
      if (!response.ok || !payload.items || !payload.expiresAt) {
        throw new Error(payload.error || "Failed to resolve file URLs");
      }

      const urls = new Map(
        payload.items.map((item) => [storageUrlCacheKey(item.key, item.imageWidth), item.url]),
      );
      for (const request of batch) {
        const cacheKey = storageUrlCacheKey(request.key, request.imageWidth);
        const url = urls.get(cacheKey);
        if (!url) {
          request.reject(new Error("Storage URL response was incomplete"));
          continue;
        }
        setCachedUrl(cacheKey, { url, expiresAt: payload.expiresAt });
        request.resolve(url);
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Failed to resolve file URLs");
      batch.forEach((request) => request.reject(failure));
    }
  }
}

function storageUrlCacheKey(key: string, imageWidth?: ImageVariantWidth): string {
  return `${key}|${imageWidth ?? "original"}`;
}

function getCachedUrl(key: string): string | null {
  const now = Date.now() + URL_EXPIRY_BUFFER_MS;
  const memory = memoryUrlCache.get(key);
  if (memory && memory.expiresAt > now) return memory.url;
  if (memory) memoryUrlCache.delete(key);

  if (typeof sessionStorage === "undefined") return null;
  const stored = readSessionUrlCache()[key];
  if (!stored || stored.expiresAt <= now) return null;
  memoryUrlCache.set(key, stored);
  return stored.url;
}

function setCachedUrl(key: string, value: CachedUrl): void {
  memoryUrlCache.set(key, value);
  if (typeof sessionStorage === "undefined") return;

  const stored = readSessionUrlCache();
  stored[key] = value;
  const now = Date.now() + URL_EXPIRY_BUFFER_MS;
  for (const [storedKey, cached] of Object.entries(stored)) {
    if (cached.expiresAt <= now) delete stored[storedKey];
  }
  try {
    sessionStorage.setItem(URL_CACHE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable or full; the in-memory cache still applies.
  }
}

function readSessionUrlCache(): Record<string, CachedUrl> {
  try {
    return JSON.parse(sessionStorage.getItem(URL_CACHE_STORAGE_KEY) || "{}") as Record<string, CachedUrl>;
  } catch {
    return {};
  }
}
