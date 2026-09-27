export type RightsContactOption = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  role_names?: string | null;
  company?: string | null;
  is_artist?: boolean | null;
  has_pro?: boolean | null;
  has_ipi?: boolean | null;
  rights_role_count?: number | null;
  publishing_role_count?: number | null;
  master_role_count?: number | null;
  credit_role_count?: number | null;
};

const WRITER_TERMS = [
  "arranger",
  "author",
  "composer",
  "lyricist",
  "songwriter",
  "writer",
];

const PRODUCER_TERMS = [
  "beatmaker",
  "producer",
  "production",
  "remixer",
];

const PUBLISHER_TERMS = [
  "publisher",
  "publishing",
];

const MASTER_OWNER_TERMS = [
  "master",
  "owner",
  "recording",
];

export function getContactOptionsForScope(
  contacts: RightsContactOption[],
  scope?: string | null,
  currentId?: string | null,
) {
  const eligible = contacts.filter((contact) => isEligibleForRightsScope(contact, scope));
  const current = currentId ? contacts.find((contact) => contact.id === currentId) ?? null : null;
  const currentOnly = current && !eligible.some((contact) => contact.id === current.id) ? current : null;
  return { eligible, currentOnly };
}

export function isEligibleForRightsScope(contact: RightsContactOption, scope?: string | null) {
  const normalizedScope = (scope || "").toLowerCase();
  const tags = contactCapabilityTags(contact);

  if (normalizedScope === "master" && Number(contact.master_role_count ?? 0) > 0) return true;
  if (normalizedScope !== "master") {
    if (contact.has_pro || contact.has_ipi || Number(contact.publishing_role_count ?? 0) > 0) return true;
  }

  if (normalizedScope === "master") {
    return tags.some((tag) => ["Artist", "Producer", "Label", "Master owner", "Performer"].includes(tag));
  }

  return tags.some((tag) => ["Artist", "Writer", "Producer", "Publisher", "PRO/IPI"].includes(tag));
}

export function contactReason(contact: RightsContactOption, scope?: string | null) {
  const normalizedScope = (scope || "").toLowerCase();
  const tags = contactCapabilityTags(contact);

  if (normalizedScope !== "master" && (contact.has_pro || contact.has_ipi)) return "PRO/IPI";
  if (normalizedScope !== "master" && Number(contact.publishing_role_count ?? 0) > 0) return "publishing";
  if (normalizedScope === "master" && Number(contact.master_role_count ?? 0) > 0) return "master";
  if (tags.length) return tags.slice(0, 2).join(", ");
  return contact.role || contact.company || "";
}

export function contactCapabilityTags(contact: RightsContactOption) {
  const roleHistory = normalize([contact.role_names].filter(Boolean).join(" "));
  const fallbackProfile = normalize([contact.role, contact.company].filter(Boolean).join(" "));
  const profileText = roleHistory || fallbackProfile;
  const tags: string[] = [];

  if (contact.is_artist) tags.push("Artist");
  if (contact.has_pro || contact.has_ipi) tags.push("PRO/IPI");
  if (hasAny(profileText, WRITER_TERMS)) tags.push("Writer");
  if (hasAny(profileText, PRODUCER_TERMS)) tags.push("Producer");
  if (hasAny(profileText, PUBLISHER_TERMS)) tags.push("Publisher");
  if (hasAny(profileText, ["label"])) tags.push("Label");
  if (hasAny(profileText, MASTER_OWNER_TERMS)) tags.push("Master owner");
  if (hasAny(profileText, ["performer", "vocalist"])) tags.push("Performer");

  return Array.from(new Set(tags));
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ");
}
