"use client";

import { useState } from "react";
import { secondaryButtonClass, helpTextClass, labelClass } from "@/components/ui/control-styles";
import { Input } from "@/components/ui/input";
import { CARRIER_OPTIONS, trackingUrl } from "@/lib/orders/carriers";

/**
 * Every carrier's link for one tracking number, through the same trackingUrl the
 * seller's panel and the buyer's order page use. Type a real number from a
 * parcel you have, open the carrier it belongs to, and see whether their page
 * finds it. The other carriers will say "not found" for it, which is correct.
 *
 * The destination only matters to PostNL, which shows a parcel to someone who
 * knows where it is going; the rest ignore it.
 */

const SAMPLE_NUMBER = "RR 1234 5678 9IE";

export function TrackingLinksGallery() {
  const [number, setNumber] = useState(SAMPLE_NUMBER);
  const [country, setCountry] = useState("NL");
  const [postcode, setPostcode] = useState("1012 AB");

  const trimmed = number.trim();
  const destination = { country: country.trim(), postalCode: postcode.trim() };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-inter text-xl font-semibold text-foreground">Tracking links</h1>
        <p className={helpTextClass}>
          Built by the real link builder. Each link opens in a new tab on the carrier&apos;s own
          site. Spaces in the number are dropped, as they are on a real order. A made-up number
          proves the page loads; a real one proves it finds the parcel.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Tracking number</span>
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            data-testid="tracking-number"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Country (PostNL)</span>
          <Input
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Postcode (PostNL)</span>
          <Input
            value={postcode}
            onChange={(event) => setPostcode(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      </section>

      <ul className="flex flex-col divide-y divide-border border border-border">
        {CARRIER_OPTIONS.map(({ value, label }) => {
          const url = trimmed ? trackingUrl(value, trimmed, destination) : null;
          return (
            <li
              key={value}
              data-carrier={value}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex flex-col gap-0.5 sm:w-48 sm:shrink-0">
                <span className="font-inter text-sm font-semibold text-foreground">{label}</span>
                <span className="font-inter text-xs text-muted-foreground">{value}</span>
              </div>
              {url ? (
                <>
                  <code
                    data-testid="tracking-url"
                    className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground"
                  >
                    {url}
                  </code>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${secondaryButtonClass} shrink-0`}
                  >
                    Open
                  </a>
                </>
              ) : (
                <span className={helpTextClass}>Type a tracking number above.</span>
              )}
            </li>
          );
        })}
      </ul>

      <p className={helpTextClass}>
        To see the link as a buyer does, simulate a sale at{" "}
        <a href="/dev/simulate-sale" className="underline underline-offset-4">
          /dev/simulate-sale
        </a>
        (signed in as a seller), mark it shipped with a carrier and number, then open the
        order link in the buyer&apos;s &quot;shipped&quot; mail at{" "}
        <a href="/dev/outbox?channel=email" className="underline underline-offset-4">
          /dev/outbox
        </a>
        . That page is raw JSON and stays empty until a mail has been sent; it also empties
        whenever the dev server restarts.
      </p>
    </main>
  );
}
