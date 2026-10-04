import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { inAMonth, paidContext } from "../pricing/fixtures";
import { CancelGallery } from "./CancelGallery";
import { DEV_CANCEL_COOKIE, readDevCancelState } from "./state";

// The cancel flow without buying a plan: a pretend subscription (a cookie)
// behind the real Settings plan card and plans page, with stand-in actions
// that cancel and keep it, and a switch for how the server answers. No
// account, no database, no Stripe. Dev-only: the route 404s in production.

export const metadata = { title: "Cancel flow: dev gallery" };

export default async function CancelDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const state = readDevCancelState((await cookies()).get(DEV_CANCEL_COOKIE)?.value);
  const context = paidContext(state.plan, state.interval, inAMonth(), { cancelAtPeriodEnd: state.ending });
  return <CancelGallery state={state} context={context} />;
}
