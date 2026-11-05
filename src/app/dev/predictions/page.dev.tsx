import { notFound } from "next/navigation";
import { PredictionsLab } from "./PredictionsLab";

// Every seller suggestion (lib/predictions.ts, lib/products/option-guesses.ts)
// against a made-up store history that can be edited row by row, with the real
// head-start chips and options editor to click. No sign-in and no database.
// Dev-only: the route 404s in production builds.

export const metadata = { title: "Predictions: dev lab" };

export default function PredictionsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PredictionsLab />;
}
