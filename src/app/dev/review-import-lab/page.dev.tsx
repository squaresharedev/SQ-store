import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The review import graphic lab (components/products/ReviewImportBeams): try
// ways of drawing the many platforms reviews come from, on the real component,
// in the import page's own column. No account and no database. Dev-only: the
// route 404s in production builds.

export const metadata = { title: "Review import graphic lab: dev" };

export default function ReviewImportLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
