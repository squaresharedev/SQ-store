// @vitest-environment jsdom
// Unit tests for cost-pass changes that need a browser-like environment:
// ai.ts system cache_control and the completion hook's abort + memo behaviour.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { act, renderHook } from "@testing-library/react";

// ---- Mocks for the completion hook tests ---------------------------------

const mockSuggestAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/products/describe-actions", () => ({
  suggestDescriptionCompletion: (...args: unknown[]) => mockSuggestAction(...args),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/components/ui/ActionErrorNotice", () => ({ useActionErrorToast: () => vi.fn() }));

// ---- Static imports (after mocks) ----------------------------------------

import { askClaude, type Ask } from "@/lib/suggestions/ai";
import { useDescriptionCompletion } from "@/components/products/use-description-completion";

// =========================================================================
// Finding 1: maxRetries: 0 (source check only; behaviour is in the node file)
// =========================================================================

describe("maxRetries: 0 (no SDK-level retry on timeout)", () => {
  it("the classifier client is built with maxRetries: 0, not 1", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/moderation/auto/classify.ts"),
      "utf8",
    );
    // With maxRetries: 1 and a 12 s timeout, a slow call is paid twice and
    // takes 24 s. The sweep retries null answers anyway, so the SDK retry
    // buys nothing.
    expect(source).toContain("maxRetries: 0");
    expect(source).not.toContain("maxRetries: 1");
  });
});

// =========================================================================
// Finding 3: system cache_control in suggestions/ai.ts
// =========================================================================

describe("suggestions system prompt cache_control", () => {
  it("system is an array block with cache_control so repeated calls read it at 0.1x", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "text", text: JSON.stringify({ value: "ok" }) }],
    }));
    const fakeAnthropic = { messages: { create } } as unknown as Anthropic;

    const ask: Ask<{ value: string }> = {
      system: "You are a helpful assistant.",
      prompt: "Say ok.",
      schema: z.object({ value: z.string() }),
      effort: "low",
    };

    await askClaude(fakeAnthropic, ask);

    const [params] = create.mock.calls[0] as unknown as [Record<string, unknown>];
    // The system prompt must be an array so cache_control is accepted (the
    // string form has no place for it). The 512-token minimum for Haiku 5.5
    // is met by the full listing system prompts (~540-1,250 tokens).
    expect(params.system).toEqual([{
      type: "text",
      text: "You are a helpful assistant.",
      cache_control: { type: "ephemeral" },
    }]);
  });
});

// =========================================================================
// Finding 5: completion hook (AbortSignal + session memo)
// =========================================================================

describe("useDescriptionCompletion", () => {
  // These inputs pass canComplete: title non-empty, text ends with a space
  // after three words, facts present.
  const TITLE = "Ceramic mug";
  const TEXT = "A mug that holds ";
  const FACTS = [{ label: "Capacity", value: "350 ml" }];

  beforeEach(() => mockSuggestAction.mockReset());

  it("drops a call when the signal is already aborted, without a network request", async () => {
    const { result } = renderHook(() =>
      useDescriptionCompletion({ title: TITLE, facts: FACTS, enabled: true }),
    );

    const controller = new AbortController();
    controller.abort();

    const suggest = result.current;
    expect(suggest).not.toBeNull();

    let outcome: string | null | undefined;
    await act(async () => {
      outcome = await suggest!(TEXT, controller.signal);
    });

    expect(outcome).toBeNull();
    // The network call must NOT be made: an aborted signal means the ask is
    // already stale before it left the client.
    expect(mockSuggestAction).not.toHaveBeenCalled();
  });

  it("returns a memo hit on the second identical call without a second network request", async () => {
    mockSuggestAction.mockResolvedValue({ ok: true, completion: "350 ml." });

    const { result } = renderHook(() =>
      useDescriptionCompletion({ title: TITLE, facts: FACTS, enabled: true }),
    );

    const suggest = result.current!;
    let first: string | null | undefined;
    let second: string | null | undefined;

    await act(async () => {
      first = await suggest(TEXT);
    });
    await act(async () => {
      second = await suggest(TEXT);
    });

    expect(first).toBe("350 ml.");
    expect(second).toBe("350 ml.");
    // The session memo must return the cached answer without a second call.
    expect(mockSuggestAction).toHaveBeenCalledTimes(1);
  });
});
