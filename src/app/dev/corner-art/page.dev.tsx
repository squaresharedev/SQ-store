import { notFound } from "next/navigation";
import { CornerArtGallery } from "./CornerArtGallery";

// Living reference for the corner pictures (ui/CornerArt): each in the lead
// card of the settings page it is drawn for, with that card's real title and
// description, beside the shipping card's route they sit alongside. No account
// and no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Corner art: dev gallery" };

export default function CornerArtDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CornerArtGallery />;
}
