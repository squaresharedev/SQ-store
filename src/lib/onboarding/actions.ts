"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";

/**
 * Record that the signed-in person has been through the dashboard welcome flow
 * (finished it, skipped it or closed it), so it never opens for them again.
 *
 * FIRST WRITE WINS. The update only matches while the column is still null, so
 * a second tab, a double click or a replayed request changes nothing and costs
 * one indexed no-op; the timestamp stays the moment they first got past it.
 *
 * THEIR OWN ROW ONLY. The id comes from the session, never from the caller,
 * and RLS ("Users can update their own profile") says the same underneath. A
 * team member welcomed while working on someone else's store records their own
 * welcome, not the owner's: the flow is about the person, not the store.
 *
 * Best effort by contract. A failed write means the flow may open once more on
 * the next visit, which is an annoyance rather than a lost fact, so it reports
 * `ok: false` instead of throwing into a dialog that is already closing.
 */
export async function completeOnboarding(): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarding_completed_at", null);
  if (error) {
    console.warn("[onboarding] could not record completion:", error.code, error.message);
    return { ok: false };
  }

  // Overview reads the flag on the server. Without this, a Back navigation or
  // a soft refresh could render the dialog again from a payload fetched before
  // the write landed.
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Record that the signed-in person has been shown their finished setup card
 * ("You're set up" with the live page link), so it is shown once and never
 * again, on any device.
 *
 * Called the first time the card renders, not when it is dismissed: a payoff
 * that waits for a click comes back on every visit for anyone who never clicks.
 *
 * Same contract as completeOnboarding: first write wins (`.is(null)`), the
 * caller's own row only, best effort.
 *
 * DELIBERATELY NO revalidatePath. This runs while the card is on screen, and a
 * revalidate would re-render Overview without it, so the card would vanish
 * under the seller the moment it appeared. The card is latched on the client for
 * this visit instead (OnboardingPanel); the next visit reads the column.
 */
export async function markSetupCelebrated(): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ setup_celebrated_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("setup_celebrated_at", null);
  if (error) {
    console.warn("[onboarding] could not record the setup card:", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Hide the sample storefront from the signed-in person's storefront list, or
 * bring it back.
 *
 * A TOGGLE, not first-write-wins: hiding stamps the time, showing clears it.
 * Nothing else is touched, because the sample is code (lib/storefront/sample.ts)
 * and this flag is all there is of it in the database.
 *
 * Their own row only (id from the session, RLS underneath). Revalidates the list
 * so a Back navigation cannot bring back the state from before the click.
 */
export async function setSampleStorefrontHidden(hidden: unknown): Promise<{ ok: boolean }> {
  // A server action is a public endpoint: the argument is whatever was posted.
  if (typeof hidden !== "boolean") return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ sample_storefront_hidden_at: hidden ? new Date().toISOString() : null })
    .eq("id", user.id);
  if (error) {
    console.warn("[onboarding] could not update the sample storefront:", error.code, error.message);
    return { ok: false };
  }
  revalidatePath("/storefront");
  return { ok: true };
}

/**
 * Record that the storefront designer tour has started for the signed-in person,
 * so it starts by itself only the first time they open the sample storefront.
 *
 * Same contract as completeOnboarding: first write wins, own row, best effort.
 * No revalidatePath: it runs while the tour is on screen, and the sample page
 * latches the start on the client for the rest of the visit (EditorTour).
 */
export async function markEditorTourSeen(): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ editor_tour_seen_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("editor_tour_seen_at", null);
  if (error) {
    console.warn("[onboarding] could not record the editor tour:", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}
