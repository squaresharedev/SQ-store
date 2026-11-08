import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The product import graphic lab (components/products/ProductImportStory): try
// ways of drawing the cursor taking products off a shelf into the catalogue, on
// the real component, in the import page's own column. No account and no
// database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Product import graphic lab: dev" };

export default function ProductImportLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
