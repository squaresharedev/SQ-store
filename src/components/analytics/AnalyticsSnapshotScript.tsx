import type { AnalyticsSnapshot } from "@/lib/analytics/types";

/**
 * The page's whole payload, published as JSON in the document.
 *
 * WHY THIS EXISTS. Data attributes on tiles cover the headline figures, but a
 * reader that wants the series, the channel split or the per-storefront
 * ranking would otherwise have to reconstruct them from SVG geometry. This is
 * the same object the charts were drawn from, serialised once, so what a
 * machine reads and what a person sees cannot drift apart. It is the shape the
 * agent surface will hand back when it exists (see docs/agent-surface.md); the
 * page publishing it now means the contract is exercised before anything
 * depends on it.
 *
 * `type="application/json"` is inert: the browser neither parses nor executes
 * it, so this is a data island, not a script. Read it with
 * `JSON.parse(document.getElementById("analytics-snapshot").textContent)`.
 *
 * NO RAW HTML SINK, deliberately. The usual JSON-in-a-script recipe reaches
 * for React's raw-HTML escape hatch; this app's rule is that it has none at all
 * (the CSP is report-only and cannot carry a nonce on this stack, so "there is
 * no sink" is doing the real work; see the search-hardening unit test that
 * enforces it). It is not needed here anyway: React renders a script's text
 * child raw, except that it rewrites the letters of any closing script tag
 * into JSON unicode escapes. The HTML parser can then no longer see an end
 * tag, while JSON.parse still returns the original characters, so a seller who
 * names a product after a closing script tag gets their title back intact and
 * cannot close the element early.
 *
 * NOTHING PRIVATE IS IN HERE. The payload is aggregates only, no buyer
 * emails, no order rows, no embed keys, no visitor digests. Everything in it
 * is already rendered on the page for the same signed-in reader; this changes
 * the FORMAT, never the audience. Anything added to AnalyticsSnapshot later
 * inherits that rule and must be checked against it.
 */
export function AnalyticsSnapshotScript({
  snapshot,
}: {
  snapshot: AnalyticsSnapshot;
}) {
  return (
    <script
      id="analytics-snapshot"
      data-analytics-snapshot="1"
      type="application/json"
    >
      {JSON.stringify(snapshot)}
    </script>
  );
}
