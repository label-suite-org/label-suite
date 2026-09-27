export function personDirectoryContacts<T extends { id: string }>(
  contactRows: T[],
  organizationRows: Array<{ id: string }>,
  artistRows: Array<{ id: string }>,
  stationRows: Array<{ id: string }>,
): T[] {
  const canonicalEntityIds = new Set([
    ...organizationRows.map((organization) => organization.id),
    ...artistRows.map((artist) => artist.id),
    ...stationRows.map((station) => station.id),
  ]);

  return contactRows.filter((contact) => !canonicalEntityIds.has(contact.id));
}
