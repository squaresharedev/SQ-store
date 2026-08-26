import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ErrorScreen } from "@/components/error/ErrorScreen";
import { buttonClassName } from "@/components/ui/button";

/**
 * The 404 for every notFound() call (bad product id, bad storefront id) and for
 * any unmatched URL on the dashboard. Without this file Next.js renders its own
 * unstyled default, which has no way back into the app.
 *
 * One CTA on purpose. A 404 is a dead end, and offering three destinations asks
 * the person who just got lost to make another choice; /dashboard is the one
 * route that is right whatever they were looking for.
 */
export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      readout="err_not_found"
      title="Page not found"
      description="This page doesn't exist, or the thing it pointed at was deleted. The link may be stale, but your account and data are fine."
      action={
        /* Inverted rather than `primary`. In the dark palette primary is the
           same purple the ring is wearing, so a primary button would put a
           second purple object on a page whose whole point is one.
           Foreground-on-background is neutral in both themes, keeps the light
           and dark versions symmetrical, and leaves the ring as the only colour
           on the screen — which is what makes it read as the subject. */
        <Link
          href="/dashboard"
          className={buttonClassName(
            "primary",
            "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          Back to dashboard
          {/* Leans along its own diagonal on hover (.cta-arrow in globals.css).
              Decorative: "Back to dashboard" already says where it goes. */}
          <ArrowUpRight
            size={16}
            strokeWidth={2}
            aria-hidden
            className="cta-arrow shrink-0"
          />
        </Link>
      }
    />
  );
}
