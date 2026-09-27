import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(
  secret: string,
  body: Uint8Array,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const suppliedHex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(suppliedHex)) return false;

  const expected = createHmac("sha256", secret).update(body).digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
