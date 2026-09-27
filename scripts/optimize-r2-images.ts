import "dotenv/config";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  IMAGE_VARIANT_WIDTHS,
  imageVariantKey,
  isGeneratedImageVariant,
  isOptimizableImageKey,
  optimizeStoredImage,
} from "../src/server/image-storage";
import { getStorageBucket, getStorageClient } from "../src/server/storage";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgId = valueAfter("--org") ?? "true-nature";
const prefix = `${orgId}/`;

const allKeys: string[] = [];
let continuationToken: string | undefined;

do {
  const page = await getStorageClient().send(new ListObjectsV2Command({
    Bucket: getStorageBucket(),
    Prefix: prefix,
    ContinuationToken: continuationToken,
  }));
  for (const object of page.Contents ?? []) {
    if (object.Key) allKeys.push(object.Key);
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

const keySet = new Set(allKeys);
const keys = allKeys.filter((key) => (
  isOptimizableImageKey(key)
  && !isGeneratedImageVariant(key)
  && IMAGE_VARIANT_WIDTHS.some((width) => !keySet.has(imageVariantKey(key, width)))
));

console.log(`${apply ? "Optimizing" : "Would optimize"} ${keys.length} images under ${prefix}`);

if (!keys.length) {
  console.log("All optimizable images already have 96px, 320px, and 800px WebP variants.");
  process.exit(0);
}

if (!apply) {
  console.log("Dry run only. Re-run with --apply to write 96px, 320px, and 800px WebP variants.");
  process.exit(0);
}

let completed = 0;
let failed = 0;
let variantBytes = 0;

for (const key of keys) {
  try {
    const result = await optimizeStoredImage(key, orgId);
    completed += 1;
    variantBytes += result.variants.reduce((sum, variant) => sum + variant.bytes, 0);
    console.log(`[${completed + failed}/${keys.length}] optimized ${redactKey(key)} (${result.variants.length} variants)`);
  } catch (error) {
    failed += 1;
    console.error(`[${completed + failed}/${keys.length}] failed ${redactKey(key)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({
  discovered: keys.length,
  completed,
  failed,
  variantBytes,
}));

if (failed) process.exitCode = 1;

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function redactKey(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "image";
  return `${orgId}/…/*.${extension}`;
}
