import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectedRows: Array<Record<string, unknown>[]> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => selectedRows.shift() ?? []),
            })),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectedRows.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  };

  return { db, selectedRows };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import { updateContactEnrichmentSuggestion } from "./gmail-enrichment";

describe("Gmail enrichment tenant boundary", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    vi.clearAllMocks();
  });

  it("rejects applying a suggestion whose contact is outside the active workspace", async () => {
    mocks.selectedRows.push([
      {
        id: "suggestion-1",
        contact_id: "contact-foreign",
        field: "email",
        value: "person@example.com",
      },
    ], []);

    await expect(updateContactEnrichmentSuggestion("org-1", {
      id: "suggestion-1",
      action: "apply",
    })).rejects.toThrow("Contact not found");

    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
