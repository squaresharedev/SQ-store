"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { PlainTextEditor } from "@/components/storefront/PlainTextEditor";
import type { CheckoutPageConfig } from "@/types/storefront";

/** The checkout's words a seller can type straight onto the canvas. */
export type CheckoutTextField = "headline" | "note" | "thanksHeadline" | "thanksMessage";

type CheckoutEdit = {
  /** Write one field; `undefined` clears it back to the default copy. */
  edit: (field: CheckoutTextField, value: string | undefined) => void;
};

const CheckoutEditContext = createContext<CheckoutEdit | null>(null);

/**
 * Makes the checkout's words editable in place. Only the editor's artboards
 * provide it; on a buyer's page there is no provider, and every EditableText
 * is plain text.
 */
export function CheckoutEditProvider({
  checkoutPage,
  onChange,
  children,
}: {
  checkoutPage: CheckoutPageConfig;
  onChange: (next: CheckoutPageConfig) => void;
  children: ReactNode;
}) {
  const edit: CheckoutEdit["edit"] = (field, value) => {
    const next = { ...checkoutPage };
    // An emptied field goes back to the default copy by being ABSENT, never
    // stored as "" (which the schema refuses): see withoutKey in the panel.
    if (value === undefined) delete next[field];
    else next[field] = value;
    onChange(next);
  };
  return <CheckoutEditContext.Provider value={{ edit }}>{children}</CheckoutEditContext.Provider>;
}

/**
 * How an editable line is FOUND on the canvas without being drawn as a field:
 * no border, no box, the words exactly as a buyer reads them. Pointing at them
 * lays the faintest wash of their own ink behind them (bled a little past the
 * words, so the text itself never moves), and the same wash, a step stronger,
 * holds while they are being typed in or keyboard-focused. The panel keeps the
 * same words as ordinary fields for anyone who would rather type there.
 */
const EDITABLE_WASH =
  // w-fit: the wash hugs the words; stretched across the column it would read
  // as a field again.
  "-mx-1.5 w-fit max-w-full rounded-sm px-1.5 transition-colors duration-base ease-standard motion-reduce:transition-none";
const EDITABLE_WASH_AT_REST = "cursor-text hover:bg-current/5 focus-visible:bg-current/10 focus-visible:outline-none";
const EDITABLE_WASH_EDITING = "bg-current/10";

/**
 * A line of the seller's own words on a checkout page: the headline, the
 * maker's note, the thank-you. For a buyer it is text. On the canvas, a click
 * puts the caret in it and the seller types straight onto the page, the way
 * the storefront's name and bio are edited on the board.
 *
 * `fallback` is what the line reads as while the seller has written nothing
 * (the default in the buyer's language, or an invitation in the editor). The
 * editor starts EMPTY in that case and shows the fallback as its placeholder:
 * seeding it with the default would store one language's words as the
 * seller's own, and every other language's buyers would read them.
 *
 * `data-setting-skip` while on the canvas: a click here means "type", not
 * "open the panel", so the artboard's click-to-setting leaves it alone.
 */
export function EditableText({
  field,
  value,
  fallback,
  fallbackIsPlaceholder = false,
  as: Tag = "p",
  multiline = false,
  maxLength,
  ariaLabel,
  className,
  attributes,
}: {
  field: CheckoutTextField;
  /** The seller's stored words, or undefined for the default. */
  value: string | undefined;
  fallback: string;
  /**
   * Whether the fallback is an INVITATION a buyer never sees (the notes'
   * "Add a note to your buyers here") rather than default copy a buyer does
   * read (the headline's "Almost yours"). An invitation is drawn in faint ink
   * on the canvas, the way a placeholder is.
   */
  fallbackIsPlaceholder?: boolean;
  as?: "h1" | "p" | "blockquote";
  multiline?: boolean;
  maxLength: number;
  /** What the field is, for a screen reader while it is being typed in. */
  ariaLabel: string;
  className?: string;
  attributes?: Record<`data-${string}`, string>;
}) {
  const context = useContext(CheckoutEditContext);
  const [editing, setEditing] = useState(false);
  const tRoot = useTranslations();

  if (!context) {
    return (
      <Tag className={className} {...attributes}>
        {value === undefined && fallbackIsPlaceholder ? <span className="opacity-40">{fallback}</span> : (value ?? fallback)}
      </Tag>
    );
  }

  if (editing) {
    const problem =
      value && hasContactOrPaymentDetails(value) ? tRoot("Validation.generic.sellerProse") : null;
    return (
      <div className="flex flex-col gap-1" data-setting-skip="">
        <PlainTextEditor
          as={Tag}
          value={value ?? ""}
          multiline={multiline}
          maxLength={maxLength}
          ariaLabel={ariaLabel}
          placeholder={fallback}
          className={cn(className, EDITABLE_WASH, EDITABLE_WASH_EDITING)}
          onChange={(next) => context.edit(field, next.trim() === "" ? undefined : next)}
          onDone={() => setEditing(false)}
        />
        {problem && (
          <p role="alert" className="font-inter text-xs font-medium text-destructive">
            {problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <Tag
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
      // No outline at rest or on hover: see EDITABLE_WASH.
      className={cn(className, EDITABLE_WASH, EDITABLE_WASH_AT_REST)}
      data-setting-skip=""
      data-editable-text={field}
      {...attributes}
    >
      {value === undefined && fallbackIsPlaceholder ? (
        // The same faintness PlainTextEditor gives its placeholder, so the
        // invitation does not change when the line is clicked into.
        <span className="opacity-40">{fallback}</span>
      ) : (
        (value ?? fallback)
      )}
    </Tag>
  );
}
