import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
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
