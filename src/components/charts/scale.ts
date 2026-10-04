// Value-axis arithmetic for callers that set the axis themselves instead of
// letting Recharts fit it to the data (a chart with something laid over the
// plot has to choose its own ceiling).

/**
 * The multiples a round step may be: 1, 2 or 5 times a power of ten.
 *
 * Not 2.5, though it would space some axes better: the kit's compact labels
 * keep one decimal ("1.2k"), and a gridline at 1,250 would be labelled "1.3k".
 * Every multiple of these three survives that rounding exactly.
 */
const STEP_FACTORS = [1, 2, 5, 10] as const;

/** A value axis draws at most this many gridlines above its baseline, and with
 *  the factors above usually no fewer than three. */
const MAX_STEPS = 7;

/**
 * Round tick values from 0 up to, and never past, `max`.
 *
 * The step is the smallest round one that fits the axis in MAX_STEPS, so the
 * labels read "0, 50, 100, 150" and not "0, 37, 74, 111". `unit` is the
 * smallest amount a label can show, and every step is a whole number of them:
 * 100 for money in cents, where a finer step would print the same whole
 * amount on two gridlines.
 */
export function niceTicks(max: number, unit = 0): number[] {
  if (!(max > 0)) return [0];
  const rough = Math.max(max / MAX_STEPS, unit);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const wholeUnits = (step: number) => unit === 0 || Number.isInteger(step / unit);
  const factor =
    STEP_FACTORS.find(
      (candidate) => candidate * magnitude >= rough && wholeUnits(candidate * magnitude),
    ) ?? 10;
  const step = factor * magnitude;
  // The epsilon forgives float noise when `max` is itself a multiple of the step.
  const steps = Math.floor(max / step + 1e-9);
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}
