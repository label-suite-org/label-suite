import { readFile } from "node:fs/promises";
import { canonicalAppOrigin } from "./request-security";
import type { PublicPageProjection } from "./campaign-public-page-core";

export type PublishedCampaignPage = PublicPageProjection & {
  slug: string;
  revision: { id: string; version: number };
};

export interface PublishedCampaignPageMetadata {
  title: string;
  description: string;
  canonical: string;
  artworkUrl: string;
}

export type PublishedCampaignPageLoader = (slug: string) => Promise<PublishedCampaignPage | null>;

export type PublishedCampaignPageRouteResult =
  | { response: Response }
  | { page: PublishedCampaignPage; metadata: PublishedCampaignPageMetadata };

export function buildPublishedCampaignPageMetadata(
  page: PublishedCampaignPage,
  siteUrl = canonicalAppOrigin(),
): PublishedCampaignPageMetadata {
  const origin = canonicalAppOrigin(siteUrl);
  const title = `${page.content.title} · ${page.content.label_line}`;
  const canonical = new URL(`/press/${encodeURIComponent(page.slug)}`, origin).toString();
  return { title, description: page.content.release_note, canonical, artworkUrl: page.artworkUrl };
}

export async function resolvePublishedCampaignPageRoute(
  slug: string | undefined,
  load?: PublishedCampaignPageLoader,
  siteUrl?: string,
): Promise<PublishedCampaignPageRouteResult> {
  const page = slug ? await (load ?? defaultPublishedCampaignPageLoader)(slug) : null;
  if (!page) return { response: new Response("Not Found", { status: 404 }) };
  return { page, metadata: buildPublishedCampaignPageMetadata(page, siteUrl) };
}

async function defaultPublishedCampaignPageLoader(slug: string): Promise<PublishedCampaignPage | null> {
  const { getPublishedCampaignPageBySlug } = await import("./campaign-public-page");
  return getPublishedCampaignPageBySlug(slug);
}

export async function publicPressRouteSourceHasNoHydrationDirective(): Promise<boolean> {
  const source = await readFile(new URL("../pages/press/[slug].astro", import.meta.url), "utf8");
  return !/client\s*:/.test(source);
}
