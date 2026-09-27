export type HotkeyId = "sidebar.toggle" | "search.open";

export type HotkeyDefinition = {
  id: HotkeyId;
  key: string;
  label: string;
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
  allowInEditable?: boolean;
};

export const HOTKEYS = {
  sidebarToggle: {
    id: "sidebar.toggle",
    key: "b",
    label: "Toggle sidebar",
    primary: true,
  },
  searchOpen: {
    id: "search.open",
    key: "k",
    label: "Open search",
    primary: true,
  },
} as const satisfies Record<string, HotkeyDefinition>;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function matchesHotkey(event: KeyboardEvent, hotkey: HotkeyDefinition) {
  if (!hotkey.allowInEditable && isEditableTarget(event.target)) {
    return false;
  }

  if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) {
    return false;
  }

  if (hotkey.primary && !(event.metaKey || event.ctrlKey)) {
    return false;
  }

  if (!hotkey.primary && (event.metaKey || event.ctrlKey)) {
    return false;
  }

  if (Boolean(hotkey.shift) !== event.shiftKey) {
    return false;
  }

  if (Boolean(hotkey.alt) !== event.altKey) {
    return false;
  }

  return true;
}

export function formatHotkey(hotkey: HotkeyDefinition) {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const primary = hotkey.primary ? (isMac ? "⌘" : "Ctrl+") : "";
  const shift = hotkey.shift ? (isMac ? "⇧" : "Shift+") : "";
  const alt = hotkey.alt ? (isMac ? "⌥" : "Alt+") : "";

  return `${primary}${shift}${alt}${hotkey.key.toUpperCase()}`;
}
