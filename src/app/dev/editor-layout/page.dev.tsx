import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { DesignerLab } from "./DesignerLab";
import { galleryPage, layoutBoardConfig } from "./fixtures";

// THE LAYOUT AND NAVIGATION GALLERY (editor upgrade, workstream 3): full-width
// bands, half-cell placement and buttons on a real board, drawn by the real
// renderers, with no sign-in and no database. Dev-only: 404 in production.
//
//   ?view=hosted    the hosted storefront page (default)
//   ?view=embed     the embed frame
//   ?view=designer  the designer's canvas, live (band rails, half-step drags,
//                   the band and button panels), with &device=mobile for its
//                   phone preview
//   ?view=legacy    the sample storefront untouched (none of these fields),
//                   on the hosted page; &frame=embed for the embed frame
//
//   &layout=free    tilt one block: a freely arranged board scales on a phone
//                   instead of reflowing
//   &phone=own      give the board a phone layout of its own (4 columns)
//   &radius=<0..40> the theme's corner radius (default 12)
//
// Phone pictures are a 390px wide screenshot of the same page: the board
// switches to its phone tier by the width it is given, as on a real phone.

export const metadata = { title: "Layout and navigation: dev gallery" };

export default async function EditorLayoutGallery({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; layout?: string; phone?: string; radius?: string; frame?: string; device?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const sample = buildSampleStorefront(await getTranslations());
  const radius = Math.min(40, Math.max(0, Number.parseInt(query.radius ?? "12", 10) || 0));
  const config = layoutBoardConfig(sample, {
    free: query.layout === "free",
    ownPhone: query.phone === "own",
    radius,
  });

  if (query.view === "designer") {
    return <DesignerLab config={config} products={sample.products} device={query.device === "mobile" ? "mobile" : "desktop"} />;
  }
  if (query.view === "legacy") {
    const page = galleryPage(sample, sample.config);
    return query.frame === "embed" ? (
      <div className="h-screen overflow-y-auto">
        <EmbedFrameView page={page} />
      </div>
    ) : (
      <StorefrontPageView page={page} />
    );
  }
  const page = galleryPage(sample, config);
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
