import { HttpError } from "./errors";

export function canonicalAppOrigin(siteUrl = process.env.PUBLIC_SITE_URL): string {
  if (!siteUrl) throw new Error("PUBLIC_SITE_URL is required");

  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be a valid absolute URL");
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("PUBLIC_SITE_URL must use http or https without credentials");
  }
  return parsed.origin;
}

export function requireSameOrigin(request: Request): string {
  const canonicalOrigin = canonicalAppOrigin();
  if (request.headers.get("origin") !== canonicalOrigin) {
    throw new HttpError("Cross-origin request denied", 403);
  }
  return canonicalOrigin;
}
