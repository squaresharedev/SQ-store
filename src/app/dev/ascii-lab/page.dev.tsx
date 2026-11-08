import { notFound } from "next/navigation";
import { mcpResourceUrl } from "@/lib/agent/paths";
import { LabLoader } from "./LabLoader";

// The ASCII lab (ui/GradientAscii): tune a field live, see it in each spot it
// could take on Settings > Connected apps, and load ready-made variations.
// No account and no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "ASCII lab: dev" };

export default function AsciiLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader mcpUrl={mcpResourceUrl()} />;
}
