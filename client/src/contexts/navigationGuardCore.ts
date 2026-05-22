export type NavigationGuardTarget = string | number;
export type NavigationGuardFn = (targetPath: string) => string | boolean;

export type NavigationGuardEntry = {
  id: number;
  guard: NavigationGuardFn;
  shouldBlock: () => boolean;
};

export type NavigationGuardDecision =
  | {
      allowed: true;
      targetPath: string;
      activeGuardIds: number[];
      confirmedGuardIds: number[];
    }
  | {
      allowed: false;
      targetPath: string;
      activeGuardIds: number[];
      blockedGuardId: number;
      confirmedGuardIds: number[];
      message: string;
    };

export const DEFAULT_UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave?";

export function normalizeNavigationTarget(
  to: NavigationGuardTarget,
  origin = typeof window === "undefined" ? undefined : window.location.origin,
): string {
  if (typeof to === "number") return `history:${to}`;
  if (!origin) return to;

  try {
    const url = new URL(to, origin);
    if (url.origin === origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Relative route strings such as "../orders" are valid navigate targets.
  }

  return to;
}

export function createNavigationGuardRegistry() {
  let entries: NavigationGuardEntry[] = [];
  let nextId = 1;

  function registerGuard(guard: NavigationGuardFn, shouldBlock: () => boolean): () => void {
    const entry: NavigationGuardEntry = {
      id: nextId,
      guard,
      shouldBlock,
    };
    nextId += 1;
    entries = [...entries, entry];

    return () => {
      entries = entries.filter((registered) => registered.id !== entry.id);
    };
  }

  function getEntries(): NavigationGuardEntry[] {
    return entries;
  }

  function getBlockingEntries(): NavigationGuardEntry[] {
    return entries.filter((entry) => {
      try {
        return entry.shouldBlock();
      } catch (error) {
        console.error("[NavigationGuard] shouldBlock threw; treating guard as active", {
          guardId: entry.id,
          error,
        });
        return true;
      }
    });
  }

  function isGuardActive(): boolean {
    return getBlockingEntries().length > 0;
  }

  function decideNavigation(
    to: NavigationGuardTarget,
    confirm: (message: string) => boolean,
    origin?: string,
  ): NavigationGuardDecision {
    const targetPath = normalizeNavigationTarget(to, origin);
    const blockingEntries = getBlockingEntries();
    const activeGuardIds = blockingEntries.map((entry) => entry.id);
    const confirmedGuardIds: number[] = [];

    for (const entry of blockingEntries) {
      let result: string | boolean;
      try {
        result = entry.guard(targetPath);
      } catch (error) {
        console.error("[NavigationGuard] guard threw; blocking navigation", {
          guardId: entry.id,
          targetPath,
          error,
        });
        result = DEFAULT_UNSAVED_CHANGES_MESSAGE;
      }

      if (!result) continue;

      const message = result === true ? DEFAULT_UNSAVED_CHANGES_MESSAGE : result;
      if (!confirm(message)) {
        return {
          allowed: false,
          targetPath,
          activeGuardIds,
          blockedGuardId: entry.id,
          confirmedGuardIds,
          message,
        };
      }

      confirmedGuardIds.push(entry.id);
    }

    return {
      allowed: true,
      targetPath,
      activeGuardIds,
      confirmedGuardIds,
    };
  }

  return {
    registerGuard,
    getEntries,
    isGuardActive,
    decideNavigation,
  };
}
