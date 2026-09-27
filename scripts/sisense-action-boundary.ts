import type { ElementHandle, Page } from "playwright";

export const PAGE_DOWNLOAD_ACTION_POLL_MS = 50;

export type WakeableCancellation = ReturnType<typeof createWakeableCancellation>;

export function pollDelayMs(remainingMs: number): number {
  if (remainingMs <= PAGE_DOWNLOAD_ACTION_POLL_MS) return 1;
  return PAGE_DOWNLOAD_ACTION_POLL_MS;
}

/**
 * Coordinates the two bounded widget observers without stranding either one
 * in a polling sleep after the competing operation has settled.
 */
export function createWakeableCancellation() {
  let cancelled = false;
  const wakeups = new Set<() => void>();

  return {
    isCancelled: () => cancelled,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      for (const wake of [...wakeups]) wake();
    },
    sleep: (timeoutMs: number) => new Promise<void>((resolve) => {
      if (cancelled) {
        resolve();
        return;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        wakeups.delete(settle);
        resolve();
      };
      const timer = setTimeout(settle, timeoutMs);
      wakeups.add(settle);
    }),
  };
}

const PAGE_DOWNLOAD_ACTION_STABILIZATION_MS = 500;

interface VisibleDownloadAction {
  element: ElementHandle;
}

export class NoDownloadAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoDownloadAvailableError";
  }
}

export async function visiblePageDownloadActions(page: Page, label: string): Promise<VisibleDownloadAction[]> {
  const candidates = page.getByText(label, { exact: false });
  const visible: VisibleDownloadAction[] = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const locator = candidates.nth(index);
    if (!(await locator.isVisible().catch(() => false))) continue;
    const element = await locator.elementHandle();
    if (element) visible.push({ element });
  }
  return visible;
}

export async function resolveNewPageDownloadAction(
  page: Page,
  label: string,
  visibleBeforeMenu: readonly VisibleDownloadAction[],
): Promise<ElementHandle> {
  const timeoutMs = 3_000;
  const deadline = Date.now() + timeoutMs;
  let selectedAction: ElementHandle | null = null;
  let newlyVisibleCount = 0;

  try {
    do {
      const newlyVisible = await newlyVisiblePageDownloadActions(page, label, visibleBeforeMenu);
      newlyVisibleCount = newlyVisible.length;
      if (newlyVisible.length === 1) {
        selectedAction = newlyVisible[0].element;
        break;
      }
      await disposeDownloadActions(newlyVisible);
      if (newlyVisible.length > 1) throw newPageDownloadActionError(label, newlyVisible.length);
      if (Date.now() < deadline) await page.waitForTimeout(PAGE_DOWNLOAD_ACTION_POLL_MS);
    } while (Date.now() < deadline);

    if (!selectedAction) throw newPageDownloadActionError(label, newlyVisibleCount);

    const stabilizationDeadline = Date.now() + PAGE_DOWNLOAD_ACTION_STABILIZATION_MS;
    do {
      await page.waitForTimeout(PAGE_DOWNLOAD_ACTION_POLL_MS);
      const newlyVisible = await newlyVisiblePageDownloadActions(page, label, visibleBeforeMenu);
      newlyVisibleCount = newlyVisible.length;
      const remainsSelected = newlyVisible.length === 1
        && await elementsMatch(selectedAction, newlyVisible[0].element);
      await disposeDownloadActions(newlyVisible);
      if (!remainsSelected) throw newPageDownloadActionError(label, newlyVisibleCount);
    } while (Date.now() < stabilizationDeadline);

    const resolved = selectedAction;
    selectedAction = null;
    return resolved;
  } finally {
    await selectedAction?.dispose().catch(() => undefined);
  }
}

async function newlyVisiblePageDownloadActions(
  page: Page,
  label: string,
  visibleBeforeMenu: readonly VisibleDownloadAction[],
): Promise<VisibleDownloadAction[]> {
  const visibleNow = await visiblePageDownloadActions(page, label);
  const newlyVisible: VisibleDownloadAction[] = [];
  try {
    for (const candidate of visibleNow) {
      const existedBeforeMenu = await Promise.all(visibleBeforeMenu.map(({ element }) => elementsMatch(candidate.element, element)))
        .then((matches) => matches.some(Boolean));
      if (!existedBeforeMenu) newlyVisible.push(candidate);
      else await candidate.element.dispose().catch(() => undefined);
    }
    return newlyVisible;
  } catch (error) {
    await disposeDownloadActions(visibleNow);
    throw error;
  }
}

async function elementsMatch(left: ElementHandle, right: ElementHandle): Promise<boolean> {
  return await left.evaluate((current, previous) => current === previous, right).catch(() => false);
}

async function disposeDownloadActions(actions: readonly VisibleDownloadAction[]): Promise<void> {
  await Promise.all(actions.map(({ element }) => element.dispose().catch(() => undefined)));
}

function newPageDownloadActionError(label: string, count: number): NoDownloadAvailableError {
  return new NoDownloadAvailableError(
    `Expected exactly one newly visible page-level ${label} action after opening the scoped widget menu; found ${count}.`,
  );
}
