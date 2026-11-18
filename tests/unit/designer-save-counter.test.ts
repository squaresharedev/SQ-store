// @vitest-environment node
/**
 * SAVE MANAGER INVARIANTS for the StorefrontDesigner.
 *
 * The two guarantees that the dirty-counter fix enforces:
 *
 *   RACE: an edit that arrives while a save is in flight must keep the dirty
 *   flag set, so a second press of Save writes it and the leave guard never
 *   lets the seller walk away with unsaved work.
 *
 *   SKIP: when nothing has changed and no overwrite is requested, handleSave
 *   must return without calling the action: the action costs eight Supabase
 *   round-trips and a full re-render, and doing it every time Ctrl+S is tapped
 *   repeatedly is pure waste.
 *
 * Both are tested below by emulating the counter+flag logic in isolation,
 * rather than mounting StorefrontDesigner (which would need the whole
 * Next.js / Supabase / next-intl stack).  The logic is straightforward enough
 * that the emulation is a faithful model of the real thing.
 */

import { describe, it, expect, vi } from "vitest";

/** Minimal save-manager that mirrors StorefrontDesigner's dirty-counter logic. */
function createSaveManager() {
  let dirty = false;
  let counter = 0;

  function markDirty() {
    counter++;
    dirty = true;
  }

  async function save(
    saveFn: () => Promise<boolean>,
    overwrite = false,
  ): Promise<boolean> {
    // Early bail: nothing to save and no forced overwrite.
    if (!dirty && !overwrite) return true;

    const counterAtStart = counter;
    const ok = await saveFn();
    if (ok && counter === counterAtStart) dirty = false;
    return ok;
  }

  return { markDirty, save, isDirty: () => dirty };
}

describe("designer dirty counter", () => {
  it("clears dirty after a clean save with no concurrent edits", async () => {
    const mgr = createSaveManager();
    mgr.markDirty();

    expect(mgr.isDirty()).toBe(true);

    let resolveOk!: () => void;
    const savePromise = mgr.save(() => new Promise<boolean>((res) => {
      resolveOk = () => res(true);
    }));

    resolveOk();
    const ok = await savePromise;

    expect(ok).toBe(true);
    expect(mgr.isDirty()).toBe(false);
  });

  it("keeps dirty when an edit arrives while a save is in flight", async () => {
    const mgr = createSaveManager();
    mgr.markDirty();

    let resolveOk!: () => void;
    const savePromise = mgr.save(() => new Promise<boolean>((res) => {
      resolveOk = () => res(true);
    }));

    // Edit arrives while the save is awaiting.
    mgr.markDirty();

    resolveOk();
    const ok = await savePromise;

    // Save succeeded, but dirty is still set because the counter moved.
    expect(ok).toBe(true);
    expect(mgr.isDirty()).toBe(true);
  });

  it("skips the action when nothing changed and no overwrite", async () => {
    const mgr = createSaveManager();
    // No markDirty(), so dirty = false.
    const saveFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);

    const ok = await mgr.save(saveFn);

    expect(ok).toBe(true);
    // The action must not have been called.
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("still runs the action when overwrite is requested even if not dirty", async () => {
    const mgr = createSaveManager();
    // Not dirty.
    const saveFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);

    const ok = await mgr.save(saveFn, /* overwrite */ true);

    expect(ok).toBe(true);
    expect(saveFn).toHaveBeenCalledOnce();
  });

  it("two sequential saves: second is a skip once dirty is cleared", async () => {
    const mgr = createSaveManager();
    mgr.markDirty();

    const saveFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);

    await mgr.save(saveFn);
    expect(mgr.isDirty()).toBe(false);

    // Second press with no new edit.
    await mgr.save(saveFn);
    expect(saveFn).toHaveBeenCalledTimes(1); // only the first call ran
  });
});
