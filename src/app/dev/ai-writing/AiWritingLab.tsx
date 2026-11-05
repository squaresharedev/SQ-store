"use client";

import { useState } from "react";
import { DescriptionAiChip, type SuggestDescription } from "@/components/products/DescriptionAiChip";
import { SuggestingTextarea } from "@/components/ui/SuggestingTextarea";
import { chipButtonClass, fieldBaseClass, helpTextClass, infoTextClass, labelClass } from "@/components/ui/control-styles";
import { cardClass, pageShellClass, pageSubtitleClass, pageTitleClass } from "@/components/ui/surface-styles";
import { Switch } from "@/components/ui/switch";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/locales";
import { msg } from "@/i18n/types";
import { actionError, failure } from "@/lib/errors";
import type { NoAnswer } from "@/lib/suggestions/ai";
import { canComplete } from "@/lib/suggestions/complete";
import { canDescribe, type ListingFact } from "@/lib/suggestions/describe";
import { fitListing } from "@/lib/suggestions/listing";
import { cn } from "@/lib/utils";
import { LISTINGS, type LabListing } from "./listings";

/**
 * THE AI WRITING LAB: the real "Write with AI" / "Improve with AI" chip
 * (components/products/DescriptionAiChip) and the real grey next words
 * (components/ui/SuggestingTextarea) on a listing picked from LISTINGS or typed
 * in, asking ./describe and ./complete (route.dev.ts) instead of the server
 * actions. Every answer stays in the list beside it with the model that gave
 * it, its time, its cost and what the model read, so runs can be compared.
 */

/** The dev routes the lab asks, one per task. */
const ROUTES = { describe: "/dev/ai-writing/describe", complete: "/dev/ai-writing/complete" } as const;

const NO_DRAFT_KEY = { too_little: "tooLittle", declined: "declined", unavailable: "unavailable" } as const;

/** What a dev route answers: the task's outcome (a draft's `text`, a
 *  suggestion's `completion`), and how it came about. */
type RouteAnswer = (
  | { ok: true; text?: string; completion?: string }
  | { ok: false; reason: NoAnswer | "too_little" }
) & { model: string; ms: number; cost: number; prompt: string };

type Attempt = RouteAnswer & { id: number; task: "write" | "improve" | "complete"; title: string; typed: string; language: string };

/** A call's cost as the lab prints it: dollars, to the millionth. */
const dollars = (micros: number) => `US$${(micros / 1_000_000).toFixed(6)}`;

/** "Label: value" lines as facts; a line without both is left out. */
function parseFacts(text: string): ListingFact[] {
  return text.split("\n").flatMap((line) => {
    const colon = line.indexOf(":");
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    return colon > 0 && label && value ? [{ label, value }] : [];
  });
}

export function AiWritingLab() {
  const [listing, setListing] = useState<LabListing>(LISTINGS[0]!);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [factsText, setFactsText] = useState(listing.facts);
  const [language, setLanguage] = useState<Locale>(listing.language);
  const [standIn, setStandIn] = useState(false);
  const [asYouType, setAsYouType] = useState(true);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  function load(next: LabListing) {
    setListing(next);
    setTitle(next.title);
    setDescription(next.description);
    setFactsText(next.facts);
    setLanguage(next.language);
  }

  const facts = parseFacts(factsText);
  const mode = description.trim() ? "improve" : "write";
  const offered = !title.trim()
    ? "Not offered: it needs a title."
    : !canDescribe({ mode, text: description, facts })
      ? "Not offered: Write with AI needs at least one fact besides the title."
      : `Offered: ${mode === "write" ? "Write" : "Improve"} with AI.`;

  /** Asks a dev route and keeps its answer in the list. */
  async function ask(route: keyof typeof ROUTES, task: Attempt["task"], body: object, typed: string): Promise<RouteAnswer> {
    const response = await fetch(standIn ? `${ROUTES[route]}?standIn=1` : ROUTES[route], {
      method: "POST",
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as RouteAnswer;
    setAttempts((list) => [{ ...answer, id: list.length + 1, task, title, typed, language }, ...list]);
    return answer;
  }

  // The chip's own request, in the language picked here instead of the page's.
  const suggest: SuggestDescription = async (request) => {
    const answer = await ask("describe", request.mode, { ...request, language }, request.text);
    if (answer.ok) return { ok: true, text: answer.text ?? "" };
    const key = NO_DRAFT_KEY[answer.reason];
    return failure(actionError("server_error", msg(`Errors.ai.${key}.message`), msg(`Errors.ai.${key}.fix`)));
  };

  // The field's next words, asked only when the form would ask (canComplete).
  const nextWords = async (text: string): Promise<string | null> => {
    const request = fitListing({ title: title.trim(), text, facts, language });
    if (!canComplete(request)) return null;
    const answer = await ask("complete", "complete", request, text);
    return answer.ok ? answer.completion || null : null;
  };

  return (
    <main className={cn(pageShellClass, "space-y-6")} data-ai-writing-lab="">
      <header className="space-y-3">
        <h1 className={pageTitleClass}>AI writing lab</h1>
        <p className={pageSubtitleClass}>
          The real Write with AI chip and the grey next words on any listing, against the real model when this
          machine has a key. Pick a sample or type your own, tap the chip or type in the description (a pause after
          a word asks), and compare the answers.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sample listings">
          {LISTINGS.map((candidate) => (
            <button
              key={candidate.name}
              type="button"
              className={chipButtonClass}
              aria-pressed={candidate.name === listing.name}
              onClick={() => load(candidate)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
        <p className={infoTextClass}>Look for: {listing.lookFor}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cn(cardClass, "min-w-0 space-y-4 p-5")} aria-labelledby="lab-listing">
          <h2 id="lab-listing" className="text-base font-semibold text-foreground">
            Listing
          </h2>
          <div className="space-y-1.5">
            <label htmlFor="lab-title" className={labelClass}>
              Title
            </label>
            <input
              id="lab-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={cn(fieldBaseClass, "py-3 text-lg font-medium")}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lab-description" className={labelClass}>
              Description
            </label>
            <SuggestingTextarea
              id="lab-description"
              value={description}
              onChange={setDescription}
              suggest={asYouType ? nextWords : null}
              labels={{
                idle: "AI suggests the next words as you type.",
                offered: "adds the grey text. Esc hides it.",
                accept: "Add the suggested words",
                announce: "Suggestion:",
                turnOff: "Turn off",
              }}
              onTurnOff={() => setAsYouType(false)}
              rows={5}
              className={cn(fieldBaseClass, "resize-y")}
            />
            <DescriptionAiChip
              key={listing.name}
              title={title}
              description={description}
              facts={facts}
              onChange={setDescription}
              suggest={suggest}
            />
            <p className={helpTextClass} data-lab-offered="">
              {offered}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lab-facts" className={labelClass}>
              Facts
            </label>
            <textarea
              id="lab-facts"
              value={factsText}
              onChange={(event) => setFactsText(event.target.value)}
              rows={5}
              aria-describedby="lab-facts-help"
              className={cn(fieldBaseClass, "resize-y font-mono")}
            />
            <p id="lab-facts-help" className={helpTextClass}>
              One per line as “Label: value”, the way the product form sends options, materials, care and sizes.{" "}
              {facts.length} read.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="lab-language" className={labelClass}>
                Dashboard language
              </label>
              <select
                id="lab-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value as Locale)}
                className={cn(fieldBaseClass, "py-1.5 text-sm")}
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_NAMES[locale]}
                  </option>
                ))}
              </select>
              <p className={infoTextClass}>Written in only when the listing&apos;s own language can&apos;t be told.</p>
            </div>
            <div className="space-y-1.5">
              <span id="lab-as-you-type" className={labelClass}>
                Suggest as you type
              </span>
              <div>
                <Switch checked={asYouType} onCheckedChange={setAsYouType} aria-labelledby="lab-as-you-type" />
              </div>
              <p className={infoTextClass}>Grey next words in the description, as a Pro seller has them.</p>
            </div>
            <div className="space-y-1.5">
              <span id="lab-stand-in" className={labelClass}>
                Stand-in (no model call)
              </span>
              <div>
                <Switch checked={standIn} onCheckedChange={setStandIn} aria-labelledby="lab-stand-in" />
              </div>
              <p className={infoTextClass}>
                The e2e stack&apos;s answers, free. A title with [[declined]] or [[unavailable]] gives that outcome.
              </p>
            </div>
          </div>
        </section>

        <section className={cn(cardClass, "min-w-0 space-y-4 p-5")} aria-labelledby="lab-answers">
          <div className="flex items-center justify-between gap-3">
            <h2 id="lab-answers" className="text-base font-semibold text-foreground">
              Answers
            </h2>
            {attempts.length > 0 && (
              <button type="button" className={chipButtonClass} onClick={() => setAttempts([])}>
                Clear
              </button>
            )}
          </div>
          {attempts.length === 0 ? (
            <p className={helpTextClass}>
              Nothing asked yet. Each answer lands here, newest first, with what it cost the platform.
            </p>
          ) : (
            <ol className="space-y-4" data-lab-answers="">
              {attempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className="min-w-0 space-y-1.5 border-t border-border pt-4 first:border-t-0 first:pt-0"
                  data-lab-answer={attempt.ok ? attempt.task : attempt.reason}
                >
                  <p className={infoTextClass}>
                    #{attempt.id} · {attempt.task} · {attempt.model} · {attempt.ms} ms · {dollars(attempt.cost)} ·
                    fallback {attempt.language}
                  </p>
                  <p className="font-inter text-sm font-medium text-foreground">{attempt.title}</p>
                  {!attempt.ok ? (
                    <p className="font-inter text-sm text-muted-foreground">No answer: {attempt.reason}</p>
                  ) : attempt.task === "complete" ? (
                    // The end of what was typed, then the suggestion in grey.
                    <p className="whitespace-pre-wrap break-words font-inter text-sm text-foreground">
                      {attempt.typed.length > 80 ? `…${attempt.typed.slice(-80)}` : attempt.typed}
                      <span className="text-muted-foreground">{attempt.completion || "(nothing suggested)"}</span>
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap break-words font-inter text-sm text-foreground">{attempt.text}</p>
                  )}
                  <details>
                    <summary className={cn(infoTextClass, "cursor-pointer")}>What the model reads</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-sm bg-muted p-3 font-mono text-xs text-foreground">
                      {attempt.prompt}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
