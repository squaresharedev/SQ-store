import type { SupabaseClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/session";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/supabase/ilike";
import { getActiveAccount, type ActiveAccount } from "@/lib/team/account-context";
import { getTeamRoster } from "@/lib/team/queries";
import { can } from "@/lib/team/permissions";
import { orderResultHref } from "@/lib/search/hrefs";
import { rankEntries } from "@/lib/search/rank";
import { parseSearchTypes, searchQuerySchema } from "@/lib/validation/search";
import type {
  RemoteSearchType,
  SearchApiResponse,
  SearchGroup,
  SearchResult,
} from "@/lib/search/types";
import { toCurrency } from "@/lib/format/money";

/**
 * GET /api/search?q=…&types=… — the REMOTE half of universal search.
 *
 * A route handler rather than a Server Action, deliberately: Server Actions are
 * POST-only and Next serialises them, so a per-keystroke typeahead would queue
 * behind itself. A GET is cancellable from the client with AbortController and
 * is uncached by default in Next 16, which is exactly what a search wants.
 *
 * ACCOUNT SCOPING IS NOT OPTIONAL. RLS lets a team member read every store they
 * belong to, so a query without an explicit owner/seller filter would blend
 * results from every store they can see into one list. Each query below pins
 * the account id resolved server-side from the (re-validated) active-account
 * cookie — never from anything the caller sent.
 *
 * FAILURE IS PER-GROUP. Every source runs under its own try/catch inside
 * Promise.allSettled, so one slow or broken table degrades that one group
 * instead of blanking the palette. The client's local index covers pages,
 * settings and actions regardless, so search stays useful even if this whole
 * endpoint is unreachable.
 */

/** Per-group caps. The palette shows a slice, not a page: anyone wanting the
 *  full list is one Enter away from the real page, which paginates properly. */
const LIMITS = {
  product: 5,
  order: 5,
  storefront: 4,
  team: 4,
  notification: 3,
} as const satisfies Record<RemoteSearchType, number>;

type Source = {
  type: RemoteSearchType;
  label: string;
  run: () => Promise<SearchResult[]>;
};

/** Merge two column-matched result sets, keeping first-seen order and dropping
 *  the row that matched on both columns twice. */
function mergeById(...sets: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const set of sets) {
    for (const result of set) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      merged.push(result);
    }
  }
  return merged;
}

function money(cents: number | null, currency: string | null): string {
  const amount = ((cents ?? 0) / 100).toFixed(2);
  return `${amount} ${toCurrency(currency ?? "EUR")}`;
}

export async function GET(request: Request) {
  // 1. Session. Never trust the client for identity.
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  // 2. Budget. Spent per request, before any query runs.
  if (!(await rateLimit("search_query", RATE_LIMITS.searchQuery))) {
    return Response.json(
      { error: "Searching too fast. Try again shortly." },
      { status: 429 },
    );
  }

  // 3. Which store are we searching? Re-validated server-side every request.
  const account = await getActiveAccount();
  if (!account) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  // 4. Input.
  const { searchParams } = new URL(request.url);
  const parsed = searchQuerySchema.safeParse({ q: searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return Response.json({ error: "Invalid search query." }, { status: 400 });
  }
  const query = parsed.data.q;
  const types = parseSearchTypes(searchParams.get("types"));

  const supabase = await createClient();
  // Escaped for ilike (%, _ and \ are wildcards there); the caller adds the
  // surrounding %…% for a contains match. PostgREST parameterises the value,
  // so this is about matching correctness, not injection.
  const pattern = `%${escapeIlike(query)}%`;

  const sources = buildSources({ supabase, account, pattern, query }).filter(
    (source) => types.includes(source.type),
  );

  const settled = await Promise.allSettled(
    sources.map(async (source) => ({
      type: source.type,
      label: source.label,
      results: await source.run(),
    })),
  );

  const groups: SearchGroup[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      // Server-side only. A broken table must not leak its message to the
      // client, and must not take the other four groups down with it.
      console.warn(
        `[search] ${sources[index]?.type} failed:`,
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
      );
      return;
    }
    if (outcome.value.results.length > 0) groups.push(outcome.value);
  });

  const body: SearchApiResponse = { query, groups };
  return Response.json(body);
}

function buildSources({
  supabase,
  account,
  pattern,
  query,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  account: ActiveAccount;
  pattern: string;
  query: string;
}): Source[] {
  const { accountId, role, userId } = account;
  // `orders` is absent from the generated Database types (see
  // lib/orders/queries.ts), so its reads go through the same untyped cast.
  const untyped = supabase as SupabaseClient;

  return [
    {
      type: "product",
      label: "Products",
      run: async () => {
        const { data, error } = await supabase
          .from("products")
          .select("id, title, status, price_cents, currency")
          .eq("owner_id", accountId)
          .ilike("title", pattern)
          .limit(LIMITS.product);
        if (error) throw new Error(error.message);
        return rankResults(
          (data ?? []).map((row) => ({
            id: `product:${row.id}`,
            type: "product" as const,
            title: row.title,
            subtitle: money(row.price_cents, row.currency),
            href: `/products/${row.id}/edit`,
            badge: row.status === "active" ? undefined : "Draft",
          })),
          query,
        );
      },
    },
    {
      type: "order",
      label: "Orders",
      run: async () => {
        // TWO queries, not one `.or()`. PostgREST's `or=` takes a PARSED filter
        // string, so a comma, period or parenthesis inside the user's term
        // breaks the expression — escapeIlike escapes ilike wildcards, not the
        // PostgREST grammar. Searching "shoes, red" would 400 or, worse,
        // silently filter on something else. Two indexed queries in parallel
        // cost one round trip's latency and cannot be confused this way.
        const columns =
          "id, product_title, buyer_email, status, amount_cents, currency, created_at";
        const [byTitle, byEmail] = await Promise.all([
          untyped
            .from("orders")
            .select(columns)
            .eq("seller_id", accountId)
            .ilike("product_title", pattern)
            .order("created_at", { ascending: false })
            .limit(LIMITS.order),
          untyped
            .from("orders")
            .select(columns)
            .eq("seller_id", accountId)
            .ilike("buyer_email", pattern)
            .order("created_at", { ascending: false })
            .limit(LIMITS.order),
        ]);
        if (byTitle.error) throw new Error(byTitle.error.message);
        if (byEmail.error) throw new Error(byEmail.error.message);

        const toResult = (row: Record<string, unknown>): SearchResult => ({
          id: `order:${String(row.id)}`,
          type: "order",
          title: String(row.product_title ?? "Order"),
          subtitle: [
            row.buyer_email ? String(row.buyer_email) : null,
            money(Number(row.amount_cents ?? 0), String(row.currency ?? "EUR")),
          ]
            .filter(Boolean)
            .join(" · "),
          href: orderResultHref(
            String(row.id),
            row.buyer_email ? String(row.buyer_email) : null,
          ),
          badge: row.status ? String(row.status) : undefined,
        });

        return mergeById(
          (byTitle.data ?? []).map(toResult),
          (byEmail.data ?? []).map(toResult),
        ).slice(0, LIMITS.order);
      },
    },
    {
      type: "storefront",
      label: "Storefronts",
      run: async () => {
        const { data, error } = await supabase
          .from("storefronts")
          .select("id, name")
          .eq("owner_id", accountId)
          .ilike("name", pattern)
          .limit(LIMITS.storefront);
        if (error) throw new Error(error.message);
        return rankResults(
          (data ?? []).map((row) => ({
            id: `storefront:${row.id}`,
            type: "storefront" as const,
            title: row.name,
            subtitle: "Open in the designer",
            href: `/storefront/${row.id}`,
          })),
          query,
        );
      },
    },
    {
      type: "team",
      label: "Team",
      run: async () => {
        // Through the roster RPC rather than the team_members table, so DISPLAY
        // NAMES are searchable and not just the address someone was invited at.
        // The roster is capped at TEAM_PAGE_SIZE (50), so filtering in JS is
        // exact and needs no index.
        if (!can(role, "team.read")) return [];
        const roster = await getTeamRoster(accountId);
        return rankEntries(
          roster,
          query,
          (member) => [member.username ?? "", member.invited_email],
          LIMITS.team,
        ).map((member) => ({
          id: `team:${member.id}`,
          type: "team" as const,
          title: member.username || member.invited_email,
          subtitle: member.username ? member.invited_email : "Invited",
          href: "/settings/team",
          badge: member.status === "active" ? member.role : member.status,
        }));
      },
    },
    {
      type: "notification",
      label: "Notifications",
      run: async () => {
        // Scoped to the USER, not the account: notifications follow the person
        // across every store they can see, they are not store data.
        const columns = "id, title, body, type, read, created_at";
        const [byTitle, byBody] = await Promise.all([
          supabase
            .from("notifications")
            .select(columns)
            .eq("user_id", userId)
            .ilike("title", pattern)
            .order("created_at", { ascending: false })
            .limit(LIMITS.notification),
          supabase
            .from("notifications")
            .select(columns)
            .eq("user_id", userId)
            .ilike("body", pattern)
            .order("created_at", { ascending: false })
            .limit(LIMITS.notification),
        ]);
        if (byTitle.error) throw new Error(byTitle.error.message);
        if (byBody.error) throw new Error(byBody.error.message);

        const toResult = (row: {
          id: string;
          title: string;
          body: string | null;
          read: boolean;
        }): SearchResult => ({
          id: `notification:${row.id}`,
          type: "notification",
          title: row.title,
          subtitle: row.body ?? undefined,
          href: "/notifications",
          badge: row.read ? undefined : "Unread",
        });

        return mergeById(
          (byTitle.data ?? []).map(toResult),
          (byBody.data ?? []).map(toResult),
        ).slice(0, LIMITS.notification);
      },
    },
  ];
}

/** Postgres `ilike` answers "does it match", never "how well". Re-rank the
 *  handful of rows it returned so a title that STARTS with the term outranks
 *  one that merely contains it. */
function rankResults(results: SearchResult[], query: string): SearchResult[] {
  return rankEntries(results, query, (result) => [result.title], results.length);
}
