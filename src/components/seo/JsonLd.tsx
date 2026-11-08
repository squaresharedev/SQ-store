import { jsonLdText } from "@/lib/seo/structured-data";

/**
 * A single <script type="application/ld+json"> element. The id lets tests
 * and E2E specs locate it without coupling to the parent's DOM structure.
 *
 * The text child is produced by jsonLdText rather than JSON.stringify so the
 * `<` escaping runs in one place and server/client output stays identical
 * (see the comment on jsonLdText for why that matters).
 */
export function JsonLd({ id, data }: { id: string; data: object }) {
  return (
    <script type="application/ld+json" id={id}>
      {jsonLdText(data)}
    </script>
  );
}
