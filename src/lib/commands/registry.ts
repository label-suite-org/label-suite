import { APP_NAV_ITEMS } from "@/lib/navigation";

export type CommandGroup = "navigation" | "setting" | "action" | "record";

export type CommandDefinition = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  group: CommandGroup;
  href?: string;
  action?: "open-search";
};

const settingsCommands = [
  {
    id: "settings",
    title: "Settings",
    subtitle: "Open workspace and account settings",
    group: "setting",
    href: "/settings",
    keywords: ["preferences", "account", "workspace"],
  },
  {
    id: "settings.profile",
    title: "Profile settings",
    subtitle: "Account identity and session actions",
    group: "setting",
    href: "/settings?section=profile",
    keywords: ["account", "user", "email", "sign out"],
  },
  {
    id: "settings.workspace",
    title: "Workspace settings",
    subtitle: "Workspace identity and metadata",
    group: "setting",
    href: "/settings?section=workspace",
    keywords: ["label", "organization", "slug"],
  },
  {
    id: "settings.members",
    title: "Members settings",
    subtitle: "Workspace access and roles",
    group: "setting",
    href: "/settings?section=members",
    keywords: ["team", "invite", "roles"],
  },
  {
    id: "settings.preferences",
    title: "Preferences settings",
    subtitle: "Theme, sidebar, and keyboard shortcuts",
    group: "setting",
    href: "/settings?section=preferences",
    keywords: ["theme", "sidebar", "hotkeys", "shortcuts", "keyboard"],
  },
  {
    id: "settings.operations",
    title: "Operations defaults",
    subtitle: "Currency, timezone, and validation policy",
    group: "setting",
    href: "/settings?section=operations",
    keywords: ["timezone", "currency", "readiness", "validation"],
  },
] as const satisfies readonly CommandDefinition[];

const actionCommands = [
  {
    id: "action.new-artist",
    title: "New artist",
    subtitle: "Open artists to create a roster entry",
    group: "action",
    href: "/artists?action=new",
    keywords: ["create artist", "add artist", "roster"],
  },
  {
    id: "action.new-release",
    title: "New release",
    subtitle: "Open releases to start a release",
    group: "action",
    href: "/releases?action=new",
    keywords: ["create release", "add release", "catalog"],
  },
  {
    id: "action.new-contact",
    title: "New contact",
    subtitle: "Open contacts to add a person or organization",
    group: "action",
    href: "/contacts?action=new",
    keywords: ["create contact", "add contact", "person"],
  },
  {
    id: "action.import-royalties",
    title: "Import royalty statement",
    subtitle: "Open royalties import workflow",
    group: "action",
    href: "/royalties?action=import",
    keywords: ["statement", "payout", "revenue", "money"],
  },
  {
    id: "action.readiness-sweep",
    title: "Run readiness sweep",
    subtitle: "Open operations tasks for validation work",
    group: "action",
    href: "/ops-tasks?action=sweep",
    keywords: ["validate", "audit", "bugs", "release readiness"],
  },
] as const satisfies readonly CommandDefinition[];

export const STATIC_COMMANDS = [
  ...APP_NAV_ITEMS.map((item) => ({
    id: `nav.${item.id}`,
    title: item.title,
    subtitle: item.url,
    group: "navigation" as const,
    href: item.url,
    keywords: item.keywords,
  })),
  ...settingsCommands,
  ...actionCommands,
] as const satisfies readonly CommandDefinition[];

