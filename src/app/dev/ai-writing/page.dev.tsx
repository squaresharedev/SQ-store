import { notFound } from "next/navigation";
import { AiWritingLab } from "./AiWritingLab";

// AI writing help (lib/suggestions, a Pro perk) on any listing picked or typed
// here: the real chip against the real model when .env.local has
// ANTHROPIC_API_KEY, else the stand-in. Every answer stays on the page with how
// long it took and what the model read. No sign-in, plan or budget, and
// nothing saves. Dev-only: the route 404s in production builds.

export const metadata = { title: "AI writing: dev lab" };

export default function AiWritingDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AiWritingLab />;
}
