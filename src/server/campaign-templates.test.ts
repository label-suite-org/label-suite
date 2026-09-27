import { describe, expect, it } from "vitest";
import {
  evaluateCampaignTemplate,
  resolveTemplatePlaceholders,
  type CampaignTemplateValidationInput,
  type CampaignTemplateSourceRecord,
  type CampaignTemplateReviewRecord,
} from "./campaign-templates";

const templateFixture: CampaignTemplateReviewRecord = {
  templateId: "template-1",
  tenantId: "tenant-1",
  subjectTemplate: "Campaign {{campaign_name}}",
  bodyTemplate: "Artist {{artist_name}} with {{release_title}}. {{station_name}}",
  reviewedAt: "2026-07-20T00:00:00.000Z",
  currentVersion: 2,
  reviewedVersion: 2,
};

const sourceFixture: CampaignTemplateSourceRecord = {
  tenantId: "tenant-1",
  templateId: "template-1",
  sourceVersion: 2,
  stale: false,
};

describe("campaign template helpers", () => {
  it("validates tenant scope and blocks cross-tenant template evaluation", () => {
    const input: CampaignTemplateValidationInput = {
      tenantId: "tenant-2",
      template: templateFixture,
      source: sourceFixture,
    };

    const result = evaluateCampaignTemplate({
      ...input,
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockers[0]).toMatchObject({
      code: "tenant_mismatch",
    });
  });

  it("flags missing-review and version-staleness before rendering", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: {
        ...templateFixture,
        reviewedAt: null,
        reviewedVersion: 1,
      },
      source: sourceFixture,
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

    const codes = result.blockers.map((blocker) => blocker.code);
    expect(result.canSend).toBe(false);
    expect(codes).toContain("template_unreviewed");
    expect(codes).toContain("version_mismatch");
  });

  it("marks source as missing when no source state is supplied", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: templateFixture,
      source: null,
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockers).toContainEqual({
      code: "source_missing",
      message: "Source template is missing.",
    });
  });

  it("flags stale source templates", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: templateFixture,
      source: {
        ...sourceFixture,
        stale: true,
      },
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockers).toContainEqual({
      code: "source_stale",
      message: "Source template is marked stale.",
    });
  });

  it("renders template placeholders into preview text", () => {
  const result = evaluateCampaignTemplate({
    tenantId: "tenant-1",
    template: templateFixture,
    source: sourceFixture,
    placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

  expect(result.canSend).toBe(true);
  if (!result.canSend) {
    throw new Error("Expected a ready result");
  }

  expect(result.blockers).toEqual([]);
  expect(result.preview.subject).toBe("Campaign Summer Drop");
  expect(result.preview.body).toBe("Artist North with North Light. WAVE FM");
  expect(result.preview.missingPlaceholders).toEqual([]);
  });

  it("returns explicit no-send when source placeholders are missing", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: templateFixture,
      source: sourceFixture,
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
      },
    });

    const noSend = result;
    expect(noSend.canSend).toBe(false);
    expect(noSend.blockers[0]).toMatchObject({
      code: "placeholder_missing",
      message: "Missing source fields for placeholders: release_title, station_name",
    });
  });

  it("treats blank placeholder values as missing source data", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: templateFixture,
      source: sourceFixture,
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "  ",
        station_name: "",
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockers[0]).toMatchObject({
      code: "placeholder_missing",
      message: "Missing source fields for placeholders: release_title, station_name",
    });
  });

  it("resolves templates and preserves unresolved placeholders", () => {
    const resolution = resolveTemplatePlaceholders("Hello {{name}}, welcome at {{place}}.", {
      name: "Ari",
    });

    expect(resolution.renderedText).toBe("Hello Ari, welcome at {{place}}.");
    expect(resolution.missingPlaceholders).toEqual(["place"]);
  });

  it("preserves placeholders for blank values during resolution", () => {
    const resolution = resolveTemplatePlaceholders("Hello {{name}}, welcome at {{place}}.", {
      name: " ",
      place: "",
    });

    expect(resolution.renderedText).toBe("Hello {{name}}, welcome at {{place}}.");
    expect(resolution.missingPlaceholders).toEqual(["name", "place"]);
  });

  it("checks source version mismatch after review", () => {
    const result = evaluateCampaignTemplate({
      tenantId: "tenant-1",
      template: {
        ...templateFixture,
        reviewedVersion: 1,
      },
      source: {
        ...sourceFixture,
        sourceVersion: 2,
      },
      placeholderValues: {
        campaign_name: "Summer Drop",
        artist_name: "North",
        release_title: "North Light",
        station_name: "WAVE FM",
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockers).toContainEqual({
      code: "source_version_mismatch",
      message: "Source template has changed since review.",
    });
  });
});
