import type {
  PublicPageProjection,
  ServerDerivedPublicHtml,
} from "../../server/campaign-public-page-core";
import type { ReactNode } from "react";

type FountainRadioUpdatePageContent = Omit<PublicPageProjection["content"], "release_note_html"> & {
  release_note_html?: ServerDerivedPublicHtml;
};

export type FountainRadioUpdatePageData = Omit<PublicPageProjection, "content" | "tracks"> & {
  slug?: string;
  revision?: { id: string; version: number };
  preview?: boolean;
  content: FountainRadioUpdatePageContent;
  tracks: readonly PublicPageProjection["tracks"][number][];
};

export interface FountainRadioUpdatePageProps {
  page: FountainRadioUpdatePageData;
}

function formatDuration(duration: number | null): string | null {
  if (duration == null || !Number.isFinite(duration) || duration < 0) return null;
  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function ActionLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      className={`fountain-press-action${primary ? " fountain-press-action-primary" : ""}`}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>{children}</span>
      <span aria-hidden="true" className="fountain-press-action-arrow">↗</span>
    </a>
  );
}

export function FountainRadioUpdatePage({ page }: FountainRadioUpdatePageProps) {
  const { content } = page;
  const releaseDate = formatDate(page.releaseDate);
  const publishedDate = page.preview ? null : formatDate(page.publishedAt);
  const updatedDate = formatDate(page.updatedAt);

  return (
    <main className="fountain-press-page">
      <div className="fountain-press-shell">
        <header className="fountain-press-header fountain-press-enter fountain-press-enter-one">
          <p className="fountain-press-kicker">Radio update</p>
          <p className="fountain-press-label">{content.label_line}</p>
        </header>

        <section className="fountain-press-intro" aria-label="Radio update introduction">
          <figure className="fountain-press-artwork fountain-press-enter fountain-press-enter-two">
            <img src={page.artworkUrl} alt={`Artwork for ${content.title}`} />
          </figure>

          <div className="fountain-press-intro-copy fountain-press-enter fountain-press-enter-three">
            <h1>{content.title}</h1>
            {content.release_note_html ? (
              <div
                className="fountain-press-note"
                dangerouslySetInnerHTML={{ __html: content.release_note_html }}
              />
            ) : (
              <p className="fountain-press-note">{content.release_note}</p>
            )}
            <nav className="fountain-press-actions" aria-label="Release actions">
              <ActionLink href={content.listen_url} primary>
                Listen to {content.title}
              </ActionLink>
              {content.download_url ? <ActionLink href={content.download_url}>Download the press edit</ActionLink> : null}
              {content.metadata_url ? <ActionLink href={content.metadata_url}>View metadata</ActionLink> : null}
            </nav>
          </div>
        </section>

        <section className="fountain-press-section fountain-press-focus" aria-labelledby="fountain-press-focus-title">
          <div className="fountain-press-section-heading">
            <p className="fountain-press-kicker">01</p>
            <h2 id="fountain-press-focus-title">Focus edits</h2>
          </div>
          <ol className="fountain-press-track-list">
            {page.tracks.map((track, index) => {
              const duration = formatDuration(track.duration);
              return (
                <li key={`${index}-${track.title}-${track.duration ?? "na"}`} className="fountain-press-track">
                  <div className="fountain-press-track-main">
                    <h3>{track.title}</h3>
                    {duration ? <span className="fountain-press-duration">{duration}</span> : null}
                  </div>
                  {track.credits.length > 0 ? (
                    <ul className="fountain-press-credits" aria-label={`Credits for ${track.title}`}>
                      {track.credits.map((credit, index) => (
                        <li key={`${credit.name}-${credit.role}-${index}`}>
                          <span>{credit.name}</span>
                          <span>{credit.role}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="fountain-press-section fountain-press-details" aria-labelledby="fountain-press-details-title">
          <div className="fountain-press-section-heading">
            <p className="fountain-press-kicker">02</p>
            <h2 id="fountain-press-details-title">Release details</h2>
          </div>
          <dl className="fountain-press-facts">
            {releaseDate ? <div><dt>Released</dt><dd><time dateTime={page.releaseDate ?? undefined}>{releaseDate}</time></dd></div> : null}
            {page.catalogNumber ? <div><dt>Catalog</dt><dd>{page.catalogNumber}</dd></div> : null}
          </dl>
          <address className="fountain-press-contact">
            <span>Press contact</span>
            <a href={`mailto:${content.contact_email}`}>{content.contact_name}</a>
          </address>
        </section>

        <footer className="fountain-press-footer">
          <p>{content.network_statement}</p>
          <p>
            {publishedDate ? <>Published <time dateTime={page.publishedAt}>{publishedDate}</time></> : null}
            {publishedDate && updatedDate ? " · " : null}
            {updatedDate ? <>Updated <time dateTime={page.updatedAt}>{updatedDate}</time></> : null}
          </p>
        </footer>
      </div>
    </main>
  );
}
