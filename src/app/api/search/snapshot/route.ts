import type { SupabaseClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/session";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { getTeamRoster } from "@/lib/team/queries";
import { can } from "@/lib/team/permissions";
import {
  EMPTY_SNAPSHOT,
  type SearchSnapshot,
  type SearchSnapshotResponse,
} from "@/lib/search/types";

/**
 * GET /api/search/snapshot — the compact per-account index behind universal
 * search's instant results.
 *
 * The palette prefetches this once shortly after the shell mounts and matches
 * against it client-side, so typing a storefront or product name answers
 * immediately — before, and independent of, the live /api/search round trip.
 * It is NAMES ONLY by design: ids, titles, statuses. No money amounts, no
 * notification bodies, no descriptions — nothing that grows unboundedly or
 * that a cached copy sitting in a browser tab should hold.
 *
 * Gates and scoping mirror /api/search exactly:
 *   - session, then rate limit, then active account — never trust the client;
 *   - every store query pins the ACTIVE account id explicitly (RLS lets a
 *     member read every store they belong to, so without the filter a
 *     member's snapshot would blend stores);
 *   - notifications pin the USER id — they follow the person, not the store;
 *   - each source fails alone (Promise.allSettled + per-source catch), so one
 *     broken table costs its group, not the snapshot.
 */

/** Caps keep the payload tens-of-KB. Newest first, so what falls off the end
 *  is exactly what the live search is still able to find. */
const CAPS = { products: 300, orders: 100, notifications: 50 } as const;

export async function GET() {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  if (!(await rateLimit("search_snapshot", RATE_LIMITS.searchSnapshot))) {
    return Response.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  const account = await getActiveAccount();
  if (!account) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const { accountId, role, userId } = account;

  const supabase = await createClient();
  // `orders` is absent from the generated Database types (see
  // lib/orders/queries.ts); reads go through the same untyped cast as v1.
  const untyped = supabase as SupabaseClient;

  const snapshot: SearchSnapshot = structuredClone(EMPTY_SNAPSHOT);

  const settled = await Promise.allSettled([
    (async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, status")
        .eq("owner_id", accountId)
        .order("created_at", { ascending: false })
        .limit(CAPS.products);
      if (error) throw new Error(error.message);
      snapshot.products = (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
      }));
    })(),
    (async () => {
      // No cap: an account holds a handful of storefronts, and the storefront
      // list itself pages at 60 — nothing here can grow pathological.
      const { data, error } = await supabase
        .from("storefronts")
        .select("id, name")
        .eq("owner_id", accountId)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      snapshot.storefronts = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
      }));
    })(),
    (async () => {
      if (!can(role, "team.read")) return;
      const roster = await getTeamRoster(accountId);
      snapshot.team = roster.map((member) => ({
        id: member.id,
        username: member.username,
        invited_email: member.invited_email,
        role: member.role,
        status: member.status,
      }));
    })(),
    (async () => {
      const { data, error } = await untyped
        .from("orders")
        .select("id, product_title, buyer_email, status")
        .eq("seller_id", accountId)
        .order("created_at", { ascending: false })
        .limit(CAPS.orders);
      if (error) throw new Error(error.message);
      snapshot.orders = (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        product_title: String(row.product_title ?? ""),
        buyer_email: row.buyer_email != null ? String(row.buyer_email) : null,
        status: String(row.status ?? ""),
      }));
    })(),
    (async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, read")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(CAPS.notifications);
      if (error) throw new Error(error.message);
      snapshot.notifications = (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        read: row.read,
      }));
    })(),
  ]);

  const labels = ["products", "storefronts", "team", "orders", "notifications"];
  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      // Server-side only; the message never reaches the client, and the group
      // simply stays empty rather than failing the snapshot.
      console.warn(
        `[search-snapshot] ${labels[index]} failed:`,
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
      );
    }
  });

  const body: SearchSnapshotResponse = { snapshot };
  return Response.json(body);
}
