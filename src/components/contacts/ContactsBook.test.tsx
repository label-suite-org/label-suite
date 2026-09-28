import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ContactsBook } from "./ContactsBook";

it("opens the linked contact and does not substitute another person when it is unavailable", () => {
  const contacts = [
    { id: "first", name: "First", notes: "First private note", organization_links: [] },
    { id: "linked", name: "Linked", notes: "Linked private note", organization_links: [] },
  ];
  const linked = renderToStaticMarkup(<ContactsBook contacts={contacts} organizations={[]} initialContactId="linked" canMutate={false} />);
  expect(linked).toContain("Linked private note");
  expect(linked).not.toContain("First private note");
  const missing = renderToStaticMarkup(<ContactsBook contacts={contacts} organizations={[]} initialContactId="missing" canMutate={false} />);
  expect(missing).toContain("The linked contact is no longer available in this workspace.");
  expect(missing).not.toContain("First private note");
});


afterEach(() => vi.restoreAllMocks());

it("renders contact and enrichment dates identically across server and browser locales", () => {
  const DateTimeFormat = Intl.DateTimeFormat;
  let defaults = { locale: "en-US", timeZone: "UTC" };
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
    return new DateTimeFormat(locales ?? defaults.locale, { timeZone: defaults.timeZone, ...options });
  });
  const timestamp = "2026-09-27T23:32:03.289Z";
  const content = <ContactsBook
    contacts={[{ id: "linked", name: "Linked", updated_at: timestamp, organization_links: [] }]}
    organizations={[]} initialContactId="linked" canMutate={false} canEnrichContacts
    gmailConnected gmailConnection={{ email: "fixture@example.test", status: "connected", last_scan_at: timestamp }}
    enrichmentSuggestions={[{ id: "suggestion", contact_id: "linked", field: "role", value: "Manager",
      normalized_value: "manager", confidence: 0.9, source_type: "gmail", status: "pending", created_at: timestamp }]}
  />;
  const server = renderToStaticMarkup(content);
  defaults = { locale: "en-GB", timeZone: "Europe/Copenhagen" };
  expect(renderToStaticMarkup(content)).toBe(server);
  expect(server).toContain("28 Sept 2026");
  expect(server).toContain("01:32");
});
