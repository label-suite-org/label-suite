import { describe, expect, it } from "vitest";
import { contactCapabilityTags, getContactOptionsForScope, isEligibleForRightsScope, type RightsContactOption } from "./contactEligibility";

const contacts: RightsContactOption[] = [
  { id: "artist", name: "Lykke Strand", is_artist: true },
  { id: "writer", name: "Mikkel", role_names: "Composer, Lyricist", has_ipi: true },
  { id: "producer", name: "Fenja", role_names: "Producer, Mixer" },
  { id: "label", name: "True Nature", role: "Label" },
  { id: "manager", name: "Management Co", role: "Manager" },
  { id: "lawyer", name: "Legal Help", role: "Lawyer" },
  { id: "generic-rights", name: "Rights Admin", role: "Manager", rights_role_count: 4 },
  { id: "previous-pub", name: "Known Publisher", publishing_role_count: 3 },
  { id: "previous-master", name: "Known Master Owner", master_role_count: 2 },
];

describe("rights contact eligibility", () => {
  it("derives writer and producer tags from actual role history before profile fallback", () => {
    expect(contactCapabilityTags(contacts[1])).toContain("Writer");
    expect(contactCapabilityTags(contacts[2])).toContain("Producer");
    expect(contactCapabilityTags({ id: "fallback", name: "Fallback", role: "Songwriter" })).toContain("Writer");
  });

  it("keeps publishing choices to writers, artists, producers, PRO/IPI contacts, and known publishing rightsholders", () => {
    const ids = contacts
      .filter((contact) => isEligibleForRightsScope(contact, "Publishing"))
      .map((contact) => contact.id);

    expect(ids).toEqual(["artist", "writer", "producer", "previous-pub"]);
    expect(ids).not.toContain("manager");
    expect(ids).not.toContain("lawyer");
    expect(ids).not.toContain("generic-rights");
  });

  it("keeps master choices to artists, producers, labels, and known master rightsholders", () => {
    const ids = contacts
      .filter((contact) => isEligibleForRightsScope(contact, "Master"))
      .map((contact) => contact.id);

    expect(ids).toEqual(["artist", "producer", "label", "previous-master"]);
    expect(ids).not.toContain("manager");
    expect(ids).not.toContain("lawyer");
    expect(ids).not.toContain("generic-rights");
  });

  it("preserves a currently selected legacy contact for review even when it is not a new candidate", () => {
    const options = getContactOptionsForScope(contacts, "Master", "manager");

    expect(options.currentOnly?.id).toBe("manager");
    expect(options.eligible.map((contact) => contact.id)).not.toContain("manager");
  });
});
