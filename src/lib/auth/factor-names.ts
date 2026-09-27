/**
 * The base name, or the first numbered variant nobody has used yet (factor
 * names are unique per account at GoTrue). The words come from the caller, in
 * the reader's language: a suggested name is copy until the person keeps it.
 * Empty when every variant up to 99 is taken.
 */
export function suggestedName(
  taken: string[],
  base: string,
  numbered: (number: number) => string,
): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = numbered(n);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}
