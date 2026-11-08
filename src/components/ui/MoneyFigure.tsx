import { useLocale } from "next-intl";
import { FitText } from "@/components/ui/FitText";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";

/** The cents of a figure, set back: a size smaller, raised to the top of the
 *  digits, and greyed, the way a banking app prints a balance. */
export const setBackCentsClass = "text-[0.6em] align-[0.42em] text-muted-foreground";

/** The decimal part of a formatted amount and whatever follows it: ".93" in
 *  "€254.93", ",93" and " €" in "254,93 €". */
const CENTS = /([.,]\d{2})(\D*)$/;

/**
 * A headline amount with its cents set back: "€254" large, ".93" small and
 * grey beside it. From integer cents through the shared formatter, so the
 * digits, the separators and where the currency sign goes follow the reader's
 * language. The text reads exactly as the formatter wrote it; only the
 * styling is split. `fit` shrinks it to its box instead of letting a long
 * figure run out of a narrow tile.
 */
export function MoneyFigure({
  cents,
  currency,
  fit = false,
  className,
}: {
  cents: number;
  currency: string;
  fit?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  // A negative zero ("-€0.00") is not an amount anyone has.
  const text = formatCents(cents === 0 ? 0 : cents, currency, locale);
  const match = CENTS.exec(text);
  const figure = (
    <span className={cn("tabular-nums", className)}>
      {match ? (
        <>
          {text.slice(0, match.index)}
          <span className={setBackCentsClass}>{match[1]}</span>
          {match[2]}
        </>
      ) : (
        text
      )}
    </span>
  );
  return fit ? <FitText measure={text}>{figure}</FitText> : figure;
}
