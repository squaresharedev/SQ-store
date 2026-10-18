import { notFound } from "next/navigation";
import {
  buildScenario,
  PAYMENTS_SCENARIOS,
  type PaymentsScenario,
} from "@/lib/payments/scenarios";
import type { PaymentsOverview } from "@/lib/payments/types";
import { PaymentsGallery } from "./PaymentsGallery";

// The Payments tab from simulated data, one scenario at a time, with no
// sign-in. Same component the real /payments route renders; only the data
// differs. Dev-only: the route 404s in production builds.

export const metadata = { title: "Payments: dev gallery" };

export default function PaymentsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const now = new Date();
  const overviews = Object.fromEntries(
    PAYMENTS_SCENARIOS.map((scenario) => [scenario, buildScenario(scenario, now)]),
  ) as Record<PaymentsScenario, PaymentsOverview>;
  return <PaymentsGallery overviews={overviews} />;
}
