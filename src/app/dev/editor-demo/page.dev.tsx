import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { galleryPage } from "../editor-layout/fixtures";
import { DEMO_PORTRAIT, DEMO_PORTRAIT_KEY, editorDemoConfig } from "./demo-config";

// THE EDITOR UPGRADE'S DEMO STOREFRONT: one board wearing every feature the
// upgrade shipped (see demo-config.ts), drawn by the real hosted page and the
// real embed frame, with no sign-in and no database. Dev-only: 404 in
// production.
//
//   ?view=hosted   the hosted storefront page (default)
//   ?view=embed    the embed frame
//   &motion=0      draw it still (for a full-length picture: the board's
//                  arrival hides what has not scrolled into view yet)
//   &cart=1        the storefront has a cart: its icon joins the header menu
//
// A phone picture is a 390px wide screenshot of the same page.

export const metadata = { title: "Editor upgrade: demo storefront" };

export default async function EditorDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; motion?: string; cart?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const sample = buildSampleStorefront(await getTranslations());
  const demo = editorDemoConfig(sample);
  const config = query.motion === "0" ? { ...demo, theme: { ...demo.theme, motion: undefined } } : demo;
  const built = galleryPage(sample, config, { cart: query.cart === "1" });
  // The image block's picture, where a real storefront has a signed URL.
  const page = { ...built, imageUrls: { ...built.imageUrls, [DEMO_PORTRAIT_KEY]: DEMO_PORTRAIT } };

  if (query.view === "embed") {
    // A real frame is exactly as tall as its content; shown as a page of its
    // own it has to scroll (see /dev/embed-frame).
    return (
      <div className="h-screen overflow-y-auto">
        <EmbedFrameView page={page} />
      </div>
    );
  }
  return <StorefrontPageView page={page} />;
}
