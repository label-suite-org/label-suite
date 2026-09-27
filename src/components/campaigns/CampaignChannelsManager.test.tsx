/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CampaignChannelsManager from "./CampaignChannelsManager";

const radioCampaign = {
  id: "campaign-1",
  campaign_name: "North Drop",
  campaign_type: "radio",
  status: "planning",
  start_date: "2026-07-28",
  end_date: null,
  main_platform: "Radio",
  release_title: "North Drop EP",
  artist_name: "North Artist",
  target_count: 1,
  with_email_count: 1,
  sent_count: 0,
  follow_up_due_count: 0,
  owner: null,
  goal: null,
  notes: null,
  kpi_summary: null,
  linked_release_id: "release-1",
  linked_artist_id: "artist-1",
  release_date: null,
  release_status: "scheduled",
  readiness: [],
  stations: [
    {
      id: "campaign-station-1",
      campaign_id: "campaign-1",
      station_id: "station-1",
      name: "Station One",
      call_sign: "NTH",
      frequency: null,
      city: "Copenhagen",
      state: null,
      country: "DK",
      email: "station@example.com",
      phone: null,
      website: null,
      dj_name: "DJ North",
      tier: "A",
      notes: null,
      status: "selected",
      last_contacted_at: null,
      follow_up_at: null,
      feedback: null,
      priority: "medium",
      pitch_angle: null,
      updated_at: null,
    },
  ],
  status_counts: {},
};

const audienceSelection = {
  campaign_audience_id: "audience-1",
  preview: {
    audience_id: "audience-1",
    audience_name: "Nordic radio",
    audience_description: "Priority Nordic radio outlets",
    counts: {
      included_contacts: 0,
      excluded_contacts: 0,
      included_stations: 1,
      excluded_stations: 0,
      explicit_contact_members: 0,
      explicit_station_members: 1,
    },
    included_stations: [
      {
        id: "station-1",
        name: "Station One",
        detail: "Copenhagen · email",
        status: "included" as const,
        reason: "Explicit member",
      },
    ],
    excluded_stations: [],
  },
};

describe("CampaignChannelsManager", () => {
  let container: HTMLDivElement;
  let root: Root;
  let reactActEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/campaigns/campaign-1/content")) {
        return new Response(JSON.stringify({
          campaign: {
            id: "campaign-1",
            campaign_name: "North Drop",
          },
          templates: [
            {
              id: "template-1",
              name: "Reviewed template",
              subject: "Hello {{station_name}}",
              body: "Featuring {{campaign_name}}",
              review_status: "reviewed",
              source_version: 2,
              current_version: 2,
            },
          ],
          selection: {
            reviewed_template_id: "template-1",
          },
        }), { headers: { "content-type": "application/json" } });
      }

      if (url.endsWith("/api/email/send")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { preview_only?: boolean };
        if (payload.preview_only) {
          return new Response(JSON.stringify({
            can_send: false,
            status: "no-send",
            provider: "brevo",
            operator_id: "operator-1",
            campaign: { id: "campaign-1", name: "North Drop" },
            audience: { id: "audience-1", name: "Nordic radio" },
            template_id: "template-1",
            preview_subject: "Hello Station One",
            preview_body: "Featuring North Drop",
            recipients: [
              {
                station_id: "station-1",
                station_name: "Station One",
                recipient_name: "DJ North",
                email: "station@example.com",
                status: "ready",
                preview_subject: "Hello Station One",
                preview_body: "Featuring North Drop",
              },
            ],
            ready_count: 1,
            skipped_count: 0,
            deduped_count: 0,
            reviewed_email: { id: "internal-draft", version: 4, approval_hash: "approval-hash" },
            reviewed_page: { id: "internal-page", version: 9, content_hash: "page-hash", status: "reviewed", slug: null },
            audience_selection: { id: "audience-1", name: "Nordic radio" },
            preview_hash: "preview-hash",
            blockers: [{ code: "batch_compliance_unavailable", message: "Batch compliance is unavailable until suppression and unsubscribe controls are reviewed" }],
          }), { headers: { "content-type": "application/json" } });
        }

        return new Response(JSON.stringify({
          results: [
            {
              station_id: "station-1",
              station_name: "Station One",
              email: "station@example.com",
              status: "sent",
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }

      throw new Error(`Unexpected fetch ${url}`);
    }));
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a no-send radio preview and never exposes a send control", async () => {
    await act(async () => {
      root.render(
        <CampaignChannelsManager
          campaignId="campaign-1"
          radioCampaign={radioCampaign}
          allStations={[{
            id: "station-1",
            name: "Station One",
            call_sign: "NTH",
            city: "Copenhagen",
            country: "DK",
            email: "station@example.com",
            dj_name: "DJ North",
            tier: "A",
          }]}
          audienceSelection={audienceSelection}
          canMutate
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Generate no-send delivery preview"),
    );
    expect(previewButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Provider:");
    expect(container.textContent).toContain("Ready recipients");
    expect(container.textContent).toContain("Delivery is blocked");
    expect(container.textContent).toContain("version 4");
    expect(container.textContent).not.toContain("internal-draft");

    const emailSendCalls = vi.mocked(fetch).mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.endsWith("/api/email/send");
    });
    expect(emailSendCalls).toHaveLength(1);
    expect(JSON.parse(String(emailSendCalls[0]?.[1]?.body ?? "{}"))).toMatchObject({ radio_update: true, preview_only: true });
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Confirm send"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/content"))).toBe(false);
  });
});
