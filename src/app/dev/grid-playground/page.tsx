import { notFound } from "next/navigation";
import { GridPlayground } from "./GridPlayground";

// Interactive harness for the shared editable <Grid>: move, corner-handle
// resize, and edge-grab resize against live state, plus a corner-radius
// toggle to verify the tile controls survive circle clipping. Dev-only, and
// what the gesture-level browser tests drive. 404s in production.

export const metadata = { title: "Grid playground — dev" };

export default function GridPlaygroundDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GridPlayground />;
}
