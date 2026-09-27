/**
 * A QR code for a phone camera to read: an authenticator app's setup code, or
 * a sign-in approval link. A white tile in either theme, because cameras read
 * dark modules on a light ground, not the other way round.
 */
export function QrTile({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a data: URL minted per use; next/image cannot optimise it and must not cache it.
    <img
      src={src}
      alt={alt}
      width={176}
      height={176}
      className="size-44 shrink-0 border border-border bg-white p-2"
    />
  );
}
