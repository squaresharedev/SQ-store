import { notFound } from "next/navigation";
import { ModalGallery } from "./ModalGallery";

// Living reference for every dialog in the product (components/ui/modal.tsx
// and what is built on it), opened from fixtures: no sign-in, no database.
// Its Blur toggle is the acceptance test of styles.md §8.14: blurred, a dialog
// should still say what it is for. `?open=<id>` opens one directly, `&blur=1`
// blurs it, and `&embed=1` is the bare view the phone frame loads. Dev-only:
// the route 404s in production builds.

export const metadata = { title: "Modals: dev gallery" };

export default async function ModalsDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { open, blur, embed } = await searchParams;
  return <ModalGallery initialOpen={open ?? null} initialBlur={blur === "1"} embed={embed === "1"} />;
}
