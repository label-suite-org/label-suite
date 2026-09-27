export const PUBLISHED_STATEMENT_STATUSES = ["issued", "closed"] as const;
export const PAYEE_VISIBLE_PAYOUT_STATUSES = ["recorded"] as const;

export interface PayeePortalContact {
  id: string;
  name: string;
  email: string | null;
}

/** Normalize the identity used to bind a payee membership to one contact. */
export function normalizePayeeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * A payee can only see a contact whose email is the authenticated user's email.
 * The database query still scopes candidates by org; this function keeps the
 * identity rule explicit and easy to exercise without a live database.
 */
export function findPayeeContact(
  contacts: readonly PayeePortalContact[],
  userEmail: string | null | undefined,
): PayeePortalContact | null {
  const normalizedEmail = normalizePayeeEmail(userEmail);
  if (!normalizedEmail) return null;
  const matches = contacts.filter((contact) => normalizePayeeEmail(contact.email) === normalizedEmail);
  return matches.length === 1 ? matches[0] : null;
}

export function isPublishedStatementStatus(status: string): boolean {
  return (PUBLISHED_STATEMENT_STATUSES as readonly string[]).includes(status);
}

export function isPayeeVisiblePayoutStatus(status: string): boolean {
  return (PAYEE_VISIBLE_PAYOUT_STATUSES as readonly string[]).includes(status);
}
