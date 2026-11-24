"use client";

import { useId, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { HeaderLogoSize } from "@/types/storefront";

/** One entry of the header's menu: its words, and where it goes (absent on
 *  the designer's canvas, where nothing navigates). */
export type MastheadLink = {
  label: string;
  anchor?: { href: string; target?: "_blank"; rel?: string };
};

/** How tall the logo is drawn, by the stored size (absent = medium). */
export const HEADER_LOGO_HEIGHT_CLASS: Record<HeaderLogoSize, string> = {
  small: "h-8",
  medium: "h-12",
  large: "h-16",
};

/** A menu entry's look: the page's own ink, underlined on hover and focus. */
const LINK_CLASS =
  "rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current";

function Entry({ link }: { link: MastheadLink }) {
  return link.anchor ? (
    <a {...link.anchor} className={LINK_CLASS} data-masthead-link="">
      {link.label}
    </a>
  ) : (
    <span className="text-sm font-medium" data-masthead-link="">
      {link.label}
    </span>
  );
}

/**
 * THE HEADER'S LOGO, beside the store's name: the uploaded artwork through a
 * plain `<img>` (an SVG reviewed at upload, as an image block's is), at one of
 * three heights. Decorative when the name is shown beside it.
 */
export function MastheadLogo({ src, alt, size }: { src: string; alt: string; size?: HeaderLogoSize }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL (an SVG may be one), like an image block's artwork.
    <img
      src={src}
      alt={alt}
      className={cn("w-auto max-w-40 shrink-0 object-contain", HEADER_LOGO_HEIGHT_CLASS[size ?? "medium"])}
      data-masthead-logo=""
    />
  );
}

/**
 * THE HEADER'S MENU: up to four links and the cart, at the right of the
 * masthead. Wide enough (the page's own container, @md), the links sit in a
 * row; narrower, they fold behind one Menu button and open as a list under
 * the masthead, in the flow (so an embed frame grows to show it rather than
 * clipping it). Nothing for the seller to design: it is the same four links.
 *
 * `fold` is off on the designer's canvas, which is not a container and shows
 * the links as they stand.
 */
export function MastheadNav({
  links,
  cart,
  fold = true,
}: {
  links: readonly MastheadLink[];
  cart?: ReactNode;
  fold?: boolean;
}) {
  const t = useTranslations("EditorLayout.board");
  const listId = useId();
  const [open, setOpen] = useState(false);
  const row = links.length > 0 && (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", fold && "hidden @md:flex")}>
      {links.map((link, index) => (
        <li key={index}>
          <Entry link={link} />
        </li>
      ))}
    </ul>
  );
  return (
    <nav aria-label={t("navLabel")} className="contents" data-masthead-nav="">
      <div className="flex shrink-0 items-center gap-3">
        {row}
        {fold && links.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex size-10 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current @md:hidden"
          >
            {open ? (
              <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        )}
        {cart}
      </div>
      {fold && open && links.length > 0 && (
        <ul id={listId} className="order-last flex w-full flex-col gap-3 pt-1 @md:hidden" data-masthead-menu="">
          {links.map((link, index) => (
            <li key={index}>
              <Entry link={link} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
