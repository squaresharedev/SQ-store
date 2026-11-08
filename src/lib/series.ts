/** A value adding up as it goes, so a sparkline rises rather than spikes. */
export function runningTotal(values: number[]): number[] {
  let sum = 0;
  return values.map((value) => (sum += value));
}
