// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentManager } from "./documents/DocumentManager";
import { MediaAssetManager } from "./media-assets/MediaAssetManager";
import { DocumentForm } from "./documents/DocumentForm";
import { MediaAssetForm } from "./media-assets/MediaAssetForm";
import BudgetDepartment from "./budget/BudgetDepartment";

const projects = [{ id: "project-1", name: "Autumn tour" }];

describe("global resource ownership queues", () => {
  it("shows repairable document ownership and evidence gaps without assigning a false owner", () => {
    const html = renderToStaticMarkup(<DocumentManager
      initialDocuments={[
        { id: "owned", name: "Tour agreement", project_id: "project-1", project_name: "Autumn tour", status: "signed", file_link: "documents/agreement.pdf" },
        { id: "unreviewed", name: "Draft rider", artist_id: "artist-1", artist_name: "Artist", status: "draft", file_link: "documents/rider.pdf" },
        { id: "missing", name: "Missing invoice", contact_id: "contact-1", contact_name: "Vendor", status: "filed", file_link: null },
        { id: "orphan", name: "Loose notes", status: "signed", file_link: "documents/notes.pdf" },
        { id: "grant", name: "Grant receipt", grant_application_count: 1, status: "filed", file_link: "documents/receipt.pdf" },
      ]}
      artists={[]}
      releases={[]}
      contacts={[]}
      projects={projects}
    />);

    expect(html).toContain("Project: Autumn tour");
    expect(html).toContain(">Unreviewed</span>");
    expect(html).toContain(">Missing file</span>");
    expect(html).toContain(">No owner</span>");
    expect(html).toContain("Repair ownership");
    expect(html).toContain("Grant evidence (1)");
  });

  it("shows project ownership and media review gaps in the global utility", () => {
    const html = renderToStaticMarkup(<MediaAssetManager
      initialAssets={[
        { id: "owned", asset_name: "Tour poster", project_id: "project-1", project_name: "Autumn tour", approval_status: "approved", file_link: "media-assets/poster.png" },
        { id: "unreviewed", asset_name: "Press photo", linked_artist_id: "artist-1", artist_name: "Artist", approval_status: "pending", file_link: "media-assets/photo.png" },
        { id: "missing", asset_name: "Video", linked_release_id: "release-1", release_title: "Release", approval_status: "approved", file_link: null },
        { id: "orphan", asset_name: "Loose art", approval_status: "approved", file_link: "media-assets/loose.png" },
      ]}
      artists={[]}
      releases={[]}
      projects={projects}
    />);

    expect(html).toContain("Project: Autumn tour");
    expect(html).toContain(">Unreviewed</span>");
    expect(html).toContain(">Missing file</span>");
    expect(html).toContain(">No owner</span>");
    expect(html).toContain("Repair ownership");
  });

  it("labels a budget by its actual owning project type", () => {
    const html = renderToStaticMarkup(<BudgetDepartment
      projects={[{ id: "video-project", name: "New video", project_type: "music_video", status: "planning", currency: "DKK", total_planned: 1000, baseline_funding: 0, track_count: null, singles_count: null, artist_name: null, release_title: null, release_format: null, cover_art_url: null }]}
      hasLegacyItems={false}
      artistOptions={[]}
      releaseOptions={[]}
    />);

    expect(html).toContain("Music video project");
    expect(html).not.toContain("Release project");
  });
});


describe("resource form accessibility", () => {
  it.each([
    ["document", <DocumentForm artists={[]} releases={[]} contacts={[]} projects={[]} onClose={() => undefined} />],
    ["media asset", <MediaAssetForm artists={[]} releases={[]} projects={[]} onClose={() => undefined} />],
  ])("associates every %s field with a visible label", (_, form) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(form);
    const controls = container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(Array.from(control.labels ?? []).some((label) => Boolean(label.textContent?.trim()))).toBe(true);
    }
  });
});


describe("contact document creation", () => {
  it("preselects the contact for a new document without changing an existing document owner", () => {
    const props = { artists: [], releases: [], projects: [], contacts: [{ id: "contact-1", name: "Vendor" }], defaultContactId: "contact-1", onClose: () => undefined };
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<DocumentForm {...props} />);
    expect(container.querySelector<HTMLSelectElement>('select[id$="-contact"]')?.value).toBe("contact-1");
    container.innerHTML = renderToStaticMarkup(<DocumentForm {...props} initial={{ id: "existing", name: "Unassigned agreement", contact_id: null }} />);
    expect(container.querySelector<HTMLSelectElement>('select[id$="-contact"]')?.value).toBe("");
  });
});
