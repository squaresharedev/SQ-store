import { useSyncExternalStore } from "react";
import { readCutout, writeCutout } from "./cache";
import { CUTOUT_MODEL, cutOut, type Cutout, type CutoutEngineState } from "./engine";

/**
 * Cutouts by photo, shared by every card on the page: six templates of one
 * product ask for the same photo and it is cut out once. BROWSER ONLY, like
 * the engine it drives.
 */

/** A photo to cut out: where to read its pixels (same origin), and what it
 *  is, stable across visits (a photo replaced by another gets a new key). */
export type CutoutPhoto = { src: string; key: string };

export type CutoutStatus =
  | { status: "working" }
  | { status: "ready"; cutout: Cutout }
  | { status: "failed"; message: string };

export type CutoutSnapshot = {
  engine: CutoutEngineState;
  photos: ReadonlyMap<string, CutoutStatus>;
};

const EMPTY: CutoutSnapshot = { engine: { phase: "idle" }, photos: new Map() };

let snapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(next: Partial<CutoutSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function setPhoto(key: string, status: CutoutStatus) {
  const photos = new Map(snapshot.photos);
  photos.set(key, status);
  emit({ photos });
}

/** Bumped whenever a stored cutout gains or changes a field, so an old entry
 *  is cut again rather than read back without it. */
const CUTOUT_CACHE_VERSION = 3;

/** Start cutting `photo` out, unless it already is or has been. The cache is
 *  keyed by the model too: a better model is a fresh cut, not a stale one. */
export function requestCutout(photo: CutoutPhoto): void {
  if (snapshot.photos.has(photo.key)) return;
  setPhoto(photo.key, { status: "working" });
  const cacheKey = `${CUTOUT_MODEL}|v${CUTOUT_CACHE_VERSION}|${photo.key}`;
  void (async () => {
    const cached = await readCutout(cacheKey);
    if (cached) {
      setPhoto(photo.key, { status: "ready", cutout: cached });
      return;
    }
    try {
      const { cutout, png } = await cutOut(photo.src, (engine) => emit({ engine }));
      setPhoto(photo.key, { status: "ready", cutout });
      await writeCutout(cacheKey, cutout, png);
    } catch (error) {
      setPhoto(photo.key, {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every photo's cutout so far, and what the engine is doing. */
export function useCutouts(): CutoutSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}
