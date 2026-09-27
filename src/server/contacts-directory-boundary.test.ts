import { describe, expect, it } from "vitest";
import { personDirectoryContacts } from "./contacts-directory-core";

describe("person directory boundary", () => {
  it("hides legacy contacts duplicated by canonical entity records", () => {
    const contacts = [
      { id: "person-1", name: "Person" },
      { id: "organization-1", name: "Legacy organization contact" },
      { id: "artist-1", name: "Legacy artist contact" },
      { id: "station-1", name: "Legacy station contact" },
    ];

    expect(personDirectoryContacts(
      contacts,
      [{ id: "organization-1" }],
      [{ id: "artist-1" }],
      [{ id: "station-1" }],
    )).toEqual([{ id: "person-1", name: "Person" }]);
  });
});
