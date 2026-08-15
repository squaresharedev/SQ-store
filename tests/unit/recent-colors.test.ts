import { describe, it, expect, vi, afterEach } from "vitest";
import {
  __resetRecentColors,
  getRecentColors,
  getRecentColorsOnServer,
  recordRecentColor,
  subscribeRecentColors,
} from "@/lib/theme/recent-colors";

// The store is module scope on purpose (see the file's comment), so one test's
// picks would otherwise be the next one's starting state.
afterEach(() => __resetRecentColors());

describe("recent colors store", () => {
  it("starts empty", () => {
    expect(getRecentColors()).toEqual([]);
  });

  it("records a committed color", () => {
    recordRecentColor("#a855f7");
    expect(getRecentColors()).toEqual(["#a855f7"]);
  });

  it("keeps the newest first", () => {
    recordRecentColor("#111111");
    recordRecentColor("#222222");
    expect(getRecentColors()).toEqual(["#222222", "#111111"]);
  });

  it("normalises to lowercase", () => {
    recordRecentColor("#ABCDEF");
    expect(getRecentColors()).toEqual(["#abcdef"]);
  });

  it("re-picking moves a color to the front rather than duplicating it", () => {
    recordRecentColor("#111111");
    recordRecentColor("#222222");
    recordRecentColor("#111111");
    expect(getRecentColors()).toEqual(["#111111", "#222222"]);
  });

  it("caps the list, dropping the oldest", () => {
    for (let i = 0; i < 14; i++) {
      recordRecentColor(`#0000${i.toString(16).padStart(2, "0")}`);
    }
    const recents = getRecentColors();
    expect(recents).toHaveLength(10);
    expect(recents[0]).toBe("#00000d");
    expect(recents).not.toContain("#000000");
  });

  it("rejects anything that is not strict 6-digit hex", () => {
    recordRecentColor("red");
    recordRecentColor("#fff");
    recordRecentColor("");
    recordRecentColor("rgba(0,0,0,0.5)");
    expect(getRecentColors()).toEqual([]);
  });

  it("notifies subscribers when the list changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentColors(listener);
    recordRecentColor("#111111");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does NOT notify when the color is already at the front", () => {
    recordRecentColor("#111111");
    const listener = vi.fn();
    const unsubscribe = subscribeRecentColors(listener);
    recordRecentColor("#111111");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not notify a rejected value", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentColors(listener);
    recordRecentColor("nonsense");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    subscribeRecentColors(listener)();
    recordRecentColor("#111111");
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a stable reference between changes, as useSyncExternalStore needs", () => {
    recordRecentColor("#111111");
    expect(getRecentColors()).toBe(getRecentColors());
  });

  it("the server snapshot is empty and stable", () => {
    recordRecentColor("#111111");
    expect(getRecentColorsOnServer()).toEqual([]);
    expect(getRecentColorsOnServer()).toBe(getRecentColorsOnServer());
  });
});
