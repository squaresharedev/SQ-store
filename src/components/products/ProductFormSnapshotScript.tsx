"use client";

import {
  PRODUCT_FORM_SNAPSHOT_ID,
  type ProductFormSnapshot,
} from "@/lib/products/form-datapoints";

/**
 * The product form's whole state, published as JSON in the document.
 *
 * Same contract and same reasoning as AnalyticsSnapshotScript, which shipped
 * first: data attributes cover one field at a time, but a reader that wants
 * "what is on this product and what is still missing" would otherwise have to
 * walk forty inputs and infer the answer. This is the object the section
 * headers and the index rail were rendered from, serialised once, so what a
 * machine reads and what a person sees cannot drift.
 *
 * `type="application/json"` is inert: the browser neither parses nor executes
 * it. Read it with
 * `JSON.parse(document.getElementById("product-form-snapshot").textContent)`.
 *
 * NO RAW HTML SINK, deliberately — this app has none at all. React renders a
 * script's text child raw except that it escapes the letters of a closing
 * script tag into JSON unicode escapes, so a seller who names a product after
 * one gets their title back intact from JSON.parse and cannot close the
 * element early.
 *
 * NOTHING PRIVATE IS IN HERE, and specifically no R2 object keys: not the
 * cover image, not a gallery photo, not a document, and above all not
 * `digital_file_key`, which IS the paywall (docs/agent-surface.md B6).
 * `buildProductFormSnapshot` emits counts and labels about those instead, and
 * builds the payload field by field so a field added to the form later cannot
 * leak by default. Everything here is already on screen for the same
 * signed-in seller; this changes the FORMAT, never the audience.
 */
export function ProductFormSnapshotScript({
  snapshot,
}: {
  snapshot: ProductFormSnapshot;
}) {
  return (
    <script
      id={PRODUCT_FORM_SNAPSHOT_ID}
      data-product-form-snapshot="1"
      type="application/json"
      // THE FORM IS A CLIENT COMPONENT, SO THIS IS SERVER-RENDERED TOO — and
      // `generatedAt` is the clock, which means the server's text and the
      // client's can never match. Without this, React called that a hydration
      // mismatch and RE-RENDERED THE WHOLE FORM to recover, remounting every
      // field back to its initial value. Anything typed before hydration
      // finished was silently thrown away, which on a slow load is a seller
      // watching their title disappear as they type.
      //
      // Suppressing the check here is exactly what the escape hatch is for:
      // the difference is deliberate and confined to this one element's text.
      // Nothing reads the snapshot before hydration, so the client's copy
      // (which is the live one, rebuilt on every render) is the only one that
      // ever matters.
      suppressHydrationWarning
    >
      {JSON.stringify(snapshot)}
    </script>
  );
}
