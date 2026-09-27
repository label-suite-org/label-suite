import {
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import {
  createDownloadUrl,
  getStorageBucket,
  getStorageClient,
  normalizeStorageKey,
  tenantStorageKey,
  uploadStorageObject,
} from "./storage";

export const IMAGE_VARIANT_WIDTHS = [96, 320, 800] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const VARIANT_CACHE_CONTROL = "private, max-age=600";
const EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;

const existenceCache = new Map<string, { exists: boolean; expiresAt: number }>();

export function imageVariantKey(key: string, width: ImageVariantWidth): string {
  return `${normalizeStorageKey(key)}.__ls_w${width}.webp`;
}

export function isGeneratedImageVariant(key: string): boolean {
  return /\.__ls_w(?:96|320|800)\.webp$/i.test(key);
}

export function isOptimizableImageKey(key: string): boolean {
  return /\.(?:avif|jpe?g|png|webp)$/i.test(key) && !isGeneratedImageVariant(key);
}

export async function createBestImageDownloadUrl(
  key: string,
  orgId: string,
  width: ImageVariantWidth,
  expiresIn?: number,
): Promise<{ url: string; optimized: boolean }> {
  const variantKey = imageVariantKey(key, width);
  const optimized = await storageObjectExists(variantKey, orgId);
  return {
    url: await createDownloadUrl(optimized ? variantKey : key, orgId, expiresIn),
    optimized,
  };
}

export async function optimizeStoredImage(
  key: string,
  orgId: string,
): Promise<{
  sourceKey: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  skipped: boolean;
  variants: Array<{ key: string; width: number; height: number | null; bytes: number }>;
}> {
  const sourceKey = tenantStorageKey(orgId, key);
  if (!isOptimizableImageKey(sourceKey)) {
    throw new Error("Only JPEG, PNG, WebP, and AVIF images can be optimized");
  }

  const existingVariants = await Promise.all(
    IMAGE_VARIANT_WIDTHS.map((width) => storageObjectExists(imageVariantKey(sourceKey, width), orgId)),
  );
  if (existingVariants.every(Boolean)) {
    return {
      sourceKey,
      sourceWidth: null,
      sourceHeight: null,
      skipped: true,
      variants: IMAGE_VARIANT_WIDTHS.map((width) => ({
        key: imageVariantKey(sourceKey, width),
        width,
        height: null,
        bytes: 0,
      })),
    };
  }

  const source = await getStorageClient().send(new GetObjectCommand({
    Bucket: getStorageBucket(),
    Key: sourceKey,
  }));

  if ((source.ContentLength ?? 0) > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Source image is too large to optimize");
  }
  if (!source.Body) {
    throw new Error("Source image body is missing");
  }

  const bytes = await source.Body.transformToByteArray();
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Source image is too large to optimize");
  }

  const metadata = await sharp(bytes).metadata();
  const variants = await Promise.all(
    IMAGE_VARIANT_WIDTHS.map(async (width) => {
      const output = await sharp(bytes)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const variantKey = imageVariantKey(sourceKey, width);

      await uploadStorageObject({
        key: variantKey,
        body: output.data,
        contentType: "image/webp",
        cacheControl: VARIANT_CACHE_CONTROL,
      }, orgId);
      rememberObjectExists(tenantStorageKey(orgId, variantKey));

      return {
        key: variantKey,
        width: output.info.width,
        height: output.info.height,
        bytes: output.info.size,
      };
    }),
  );

  return {
    sourceKey,
    sourceWidth: metadata.width ?? null,
    sourceHeight: metadata.height ?? null,
    skipped: false,
    variants,
  };
}

async function storageObjectExists(key: string, orgId: string): Promise<boolean> {
  const storageKey = tenantStorageKey(orgId, key);
  const cached = existenceCache.get(storageKey);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;

  try {
    await getStorageClient().send(new HeadObjectCommand({
      Bucket: getStorageBucket(),
      Key: storageKey,
    }));
    rememberObjectExists(storageKey);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      existenceCache.set(storageKey, {
        exists: false,
        expiresAt: Date.now() + EXISTS_CACHE_TTL_MS,
      });
      return false;
    }
    throw error;
  }
}

function rememberObjectExists(storageKey: string): void {
  existenceCache.set(storageKey, {
    exists: true,
    expiresAt: Date.now() + EXISTS_CACHE_TTL_MS,
  });
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}
