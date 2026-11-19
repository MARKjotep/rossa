import { Refl } from "@ohmyqt/u";
import { GUARD_KEY } from "./@.guard";

type Class = new (...args: any[]) => any;

export function mergeGuards(classGuards: any[], cs: Class | Function): any[] {
  const methodGuard = Refl.get.method(GUARD_KEY, cs);

  const finalCombinedWrappers: any[] = [];
  const methodWrappersMap = new Map();

  // Map all method overrides by their unique ID for O(1) lookups
  for (const mw of methodGuard) {
    if (mw._middlewareId) {
      methodWrappersMap.set(mw._middlewareId, mw);
    }
  }

  for (const classWrapper of classGuards) {
    if (
      classWrapper._middlewareId &&
      methodWrappersMap.has(classWrapper._middlewareId)
    ) {
      // Override! Swap class wrapper for the method wrapper
      finalCombinedWrappers.push(
        methodWrappersMap.get(classWrapper._middlewareId),
      );
      methodWrappersMap.delete(classWrapper._middlewareId); // Mark as consumed
    } else {
      // Keep the class default (or stackable class wrapper)
      finalCombinedWrappers.push(classWrapper);
    }
  }

  // Pass 2: Append brand-new Method Wrappers & Stackable Method Wrappers
  for (const mw of methodGuard) {
    // If mw._middlewareId is UNDEFINED (Stackable) -> Push it!
    // If mw._middlewareId is STILL in the map (New Singleton) -> Push it!
    if (!mw._middlewareId || methodWrappersMap.has(mw._middlewareId)) {
      finalCombinedWrappers.push(mw);

      // Cleanup to keep the map pristine
      if (mw._middlewareId) methodWrappersMap.delete(mw._middlewareId);
    }
  }

  return finalCombinedWrappers;
}
