import { expect, test, type Page } from "@playwright/test";
import {
  anonRest,
  freshUser,
  seedSignals,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// The analytics page's SIGNAL half: the sources that are not sales.
//
// What these guard, in order of how much it would cost to get wrong:
//
//  1. A source with no producer must never render a zero. "0 signups" and
//     "signups are not counted yet" are different sentences and only one of
//     them is true; a seller acting on the wrong one stops promoting a form
//     that was never wired up.
//  2. A source lights up on its own the moment rows arrive, with no code
//     change. That property is the whole reason for the registry, and it is
//     invisible in review, only a test that inserts a row for an "awaiting"
//     kind and then looks at the page can hold it.
//  3. The machine-readable layer says what the rendered layer says. Two
//     surfaces publishing the same numbers is exactly the pair that drifts.
//  4. The stream is not readable or writable by a client-facing role.

/** The seller's own storefront id, seeded straight in. */
async function seedStorefrontFor(sellerId: string, name: string) {
  await seedStorefronts(sellerId, [{ name }]);
  const rows = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id,name`,
  )) as { id: string; name: string }[];
  const row = rows.find((candidate) => candidate.name === name);
  expect(row, `no storefront named ${name}`).toBeTruthy();
  return row!.id;
}

/** The page's published payload, parsed. */
async function snapshot(page: Page) {
  const raw = await page.locator("#analytics-snapshot").textContent();
  expect(raw, "no analytics snapshot on the page").toBeTruthy();
  return JSON.parse(raw!) as {
    version: number;
    currency: string;
    range: { from: string | null; to: string | null; preset: string };
    sales: { totals: { revenueCents: number; sales: number } };
    signals: {
      available: boolean;
      byKind: Record<string, { totals: { count: number; uniqueVisitors: number } }>;
    };
  };
}

test.describe("analytics, signal sources", () => {
  test("a seller only sees the sources they actually run", async ({ page }) => {
    // The rule is "is this yours", not "does this exist". A seller with no
    // booking block has no reason to scroll past a bookings section, and a
    // placeholder for a feature they have not adopted pushes the numbers they
    // came for further down their own page.
    const user = freshUser("signals");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(sellerId, "Signal shop");

    await seedSignals(sellerId, [
      ...Array.from({ length: 12 }, (_, i) => ({
        kind: "storefront_view" as const,
        storefrontId,
        daysAgo: (i % 6) + 1,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: "product_click" as const,
        storefrontId,
        channel: "direct" as const,
        daysAgo: i + 1,
      })),
    ]);

    await page.goto("/analytics");

    // Shown, because they are measured and this account has the data.
    const views = page.locator('[data-analytics-section="storefront_view"]');
    await expect(views).toHaveAttribute("data-analytics-state", "live", {
      timeout: 20_000,
    });
    await expect(
      views.locator('[data-analytics-metric="storefront_view.count"]'),
    ).toHaveAttribute("data-analytics-value", "12");

    const clicks = page.locator('[data-analytics-section="product_click"]');
    await expect(clicks).toHaveAttribute("data-analytics-state", "live");
    await expect(
      clicks.locator('[data-analytics-metric="product_click.count"]'),
    ).toHaveAttribute("data-analytics-value", "4");

    // NOT shown at all: no block placed, no history. Not a zero, not a
    // placeholder, not in the DOM.
    for (const kind of ["email_signup", "booking"]) {
      await expect(
        page.locator(`[data-analytics-section="${kind}"]`),
      ).toHaveCount(0);
    }
    await expect(page.getByText(/email signup block/i)).toHaveCount(0);
    await expect(page.getByText(/calendar booking block/i)).toHaveCount(0);
  });

  test("placing the block is what brings its section back, before any data", async ({
    page,
  }) => {
    // The other half of the relevance rule, and the one that makes the page
    // right on day one of a new feature: a seller who has just placed a signup
    // block should see the section waiting and empty, not have it appear only
    // after a stranger has already signed up.
    const user = freshUser("blockrel");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(sellerId, "Block shop");

    await page.goto("/analytics");
    await expect(
      page.locator('[data-analytics-section="storefront_view"]'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('[data-analytics-section="email_signup"]'),
    ).toHaveCount(0);

    // Write a block of the FUTURE type straight into the config. The block
    // does not exist in the schema yet, which is exactly the point: the
    // relevance check reads block types out of the stored jsonb in SQL, so it
    // is already correct for a block this build has never heard of. Service
    // role, because no validated write path would accept this.
    await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          theme: {},
          blocks: [{ type: "email_signup", id: "s1", x: 0, y: 0, w: 1, h: 1 }],
        },
      },
    });

    await page.reload();
    const signups = page.locator('[data-analytics-section="email_signup"]');
    // Present, and honest about having nothing yet: awaiting, no value at all.
    await expect(signups).toHaveAttribute("data-analytics-state", "awaiting", {
      timeout: 20_000,
    });
    const tile = signups.locator('[data-analytics-metric="email_signup.count"]');
    expect(await tile.getAttribute("data-analytics-value")).toBeNull();
    await expect(
      page.getByText(/arrives with the email signup block/i),
    ).toHaveCount(1);
    // Bookings are still not this seller's business.
    await expect(page.locator('[data-analytics-section="booking"]')).toHaveCount(0);
  });

  test("a source lights up on its own once its first rows arrive", async ({
    page,
  }) => {
    // The registry's whole promise: shipping the booking block should be a
    // producer plus a one-line registry edit, never a new screen. Nothing in
    // this test knows anything about bookings beyond the kind string.
    const user = freshUser("lightup");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(sellerId, "Booking shop");

    await page.goto("/analytics");
    await expect(
      page.locator('[data-analytics-section="storefront_view"]'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-analytics-section="booking"]')).toHaveCount(0);

    await seedSignals(sellerId, [
      { kind: "booking", storefrontId, valueCents: 4_500, daysAgo: 2 },
      { kind: "booking", storefrontId, valueCents: 5_500, daysAgo: 3 },
    ]);

    await page.reload();
    const bookings = page.locator('[data-analytics-section="booking"]');
    await expect(bookings).toHaveAttribute("data-analytics-state", "live", {
      timeout: 20_000,
    });
    await expect(
      bookings.locator('[data-analytics-metric="booking.count"]'),
    ).toHaveAttribute("data-analytics-value", "2");
    // A money-carrying source publishes integer cents, and renders the total.
    await expect(
      bookings.locator('[data-analytics-metric="booking.value"]'),
    ).toHaveAttribute("data-analytics-value", "10000");
    await expect(bookings.getByText("€100.00").first()).toBeVisible();
  });

  test("the published snapshot agrees with the rendered tiles", async ({
    page,
  }) => {
    const user = freshUser("snapshot");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(sellerId, "Snapshot shop");
    await seedSignals(sellerId, [
      { kind: "storefront_view", storefrontId, visitorHash: "a".repeat(64), daysAgo: 1 },
      { kind: "storefront_view", storefrontId, visitorHash: "a".repeat(64), daysAgo: 2 },
      { kind: "storefront_view", storefrontId, visitorHash: "b".repeat(64), daysAgo: 3 },
    ]);

    await page.goto("/analytics");
    const tile = page.locator('[data-analytics-metric="storefront_view.count"]');
    await expect(tile).toHaveAttribute("data-analytics-value", "3", {
      timeout: 20_000,
    });

    const data = await snapshot(page);
    expect(data.version).toBe(1);
    expect(data.currency).toBe("EUR");
    expect(data.range.preset).toBe("30d");
    // The window has to be resolved, or a figure cannot be read back later.
    expect(data.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.signals.available).toBe(true);
    expect(data.signals.byKind.storefront_view.totals.count).toBe(3);
    // Two digests across three rows: distinct visitors, not row count.
    expect(data.signals.byKind.storefront_view.totals.uniqueVisitors).toBe(2);
    expect(data.signals.byKind.booking.totals.count).toBe(0);

    // Both surfaces, one set of numbers.
    expect(String(data.signals.byKind.storefront_view.totals.count)).toBe(
      await tile.getAttribute("data-analytics-value"),
    );
  });

  test("every section survives a phone viewport without sideways scroll", async ({
    page,
  }) => {
    const user = freshUser("sigmobile");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(
      sellerId,
      "A storefront with a deliberately long name",
    );
    await seedSignals(sellerId, [
      { kind: "storefront_view", storefrontId, daysAgo: 1 },
      { kind: "storefront_view", storefrontId, channel: "direct", daysAgo: 2 },
      { kind: "product_click", storefrontId, daysAgo: 1 },
    ]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/analytics");
    await expect(
      page.locator('[data-analytics-section="storefront_view"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Every section is reachable and none of them push the document wider than
    // the screen. A chart that overflows is not a cosmetic problem on a phone:
    // it takes the whole page's horizontal scroll with it.
    for (const id of ["sales", "storefront_view", "product_click"]) {
      await expect(page.locator(`[data-analytics-section="${id}"]`)).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(1);
  });

  test("serving the embed records a view, and a refresh does not double it", async ({
    page,
  }) => {
    // The one PRODUCER that ships live. Without this the whole pipeline is
    // untested end to end: the aggregate, the section and the snapshot could
    // all be right while nothing ever writes a row.
    const user = freshUser("embedview");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedStorefrontFor(sellerId, "Embedded shop");

    const stored = (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id,embed_key,config`,
    )) as { id: string; embed_key: string; config: Record<string, unknown> }[];
    await serviceRest(`/storefronts?id=eq.${stored[0].id}`, {
      method: "PATCH",
      body: {
        config: {
          ...stored[0].config,
          embed: { enabled: true, domains: ["example.com"] },
        },
      },
    });

    const fetchEmbed = () =>
      page.request.get(`/api/embed/${stored[0].embed_key}`, {
        headers: { origin: "https://example.com" },
      });

    expect((await fetchEmbed()).ok()).toBe(true);
    // Twice more from the same client: deduped to one visit per hour, so the
    // figure is a VISIT and a refresh loop cannot inflate it.
    expect((await fetchEmbed()).ok()).toBe(true);
    expect((await fetchEmbed()).ok()).toBe(true);

    const rows = (await serviceRest(
      `/storefront_signals?account_id=eq.${sellerId}&select=kind,channel,storefront_id,visitor_hash`,
    )) as { kind: string; channel: string; storefront_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("storefront_view");
    expect(rows[0].channel).toBe("embed");
    expect(rows[0].storefront_id).toBe(stored[0].id);

    // A REFUSED request is not a view: a wrong origin must not be countable,
    // or anyone could run a seller's numbers up from outside the allowlist.
    const denied = await page.request.get(`/api/embed/${stored[0].embed_key}`, {
      headers: { origin: "https://not-allowed.example" },
    });
    expect(denied.ok()).toBe(false);
    const after = (await serviceRest(
      `/storefront_signals?account_id=eq.${sellerId}&select=kind`,
    )) as unknown[];
    expect(after.length).toBe(1);

    // And it reaches the page it was recorded for.
    await page.goto("/analytics");
    await expect(
      page.locator('[data-analytics-metric="storefront_view.count"]'),
    ).toHaveAttribute("data-analytics-value", "1", { timeout: 20_000 });
  });

  test("the widget signal route takes clicks, and refuses everything else", async ({
    page,
  }) => {
    // The seam a future embed block reports through. What it accepts is an
    // allowlist of ONE kind, and the refusals are the point of the test:
    // storefront_view is server-produced, and conversions get written next to
    // the row they create, not instead of it.
    const user = freshUser("sigingest");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedStorefrontFor(sellerId, "Ingest shop");

    const stored = (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id,embed_key,config`,
    )) as { id: string; embed_key: string; config: Record<string, unknown> }[];
    await serviceRest(`/storefronts?id=eq.${stored[0].id}`, {
      method: "PATCH",
      body: {
        config: {
          ...stored[0].config,
          embed: { enabled: true, domains: ["example.com"] },
        },
      },
    });

    const post = (body: unknown, origin = "https://example.com") =>
      page.request.post(`/api/embed/${stored[0].embed_key}/signal`, {
        headers: { origin },
        data: body,
      });

    expect((await post({ kind: "product_click", blockId: "b1" })).status()).toBe(204);

    // Not a view: the server counts those itself, and a client that could post
    // one could post ten thousand.
    expect((await post({ kind: "storefront_view" })).status()).toBe(400);
    // Not a conversion either.
    expect((await post({ kind: "email_signup" })).status()).toBe(400);
    expect((await post({ kind: "booking", valueCents: 999_999 })).status()).toBe(400);
    // Unknown fields are refused outright rather than quietly dropped.
    expect((await post({ kind: "product_click", accountId: sellerId })).status()).toBe(400);
    // And the origin allowlist gates it exactly like the read route.
    expect(
      (await post({ kind: "product_click" }, "https://not-allowed.example")).status(),
    ).toBe(403);

    const rows = (await serviceRest(
      `/storefront_signals?account_id=eq.${sellerId}&select=kind,block_id,metadata`,
    )) as { kind: string; block_id: string | null }[];
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("product_click");
    expect(rows[0].block_id).toBe("b1");
  });

  test("the hover readout lands at the pointer and paints over its neighbours", async ({
    page,
  }) => {
    // The regression this exists for: recharts tweens a tooltip's POSITION, so
    // the first hover of a session launched the readout from the chart's
    // top-left corner and flew it to the cursor. A readout that is still
    // arriving is a readout you cannot read.
    const user = freshUser("sigtip");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await seedStorefrontFor(sellerId, "Tooltip shop");
    await seedSignals(
      sellerId,
      Array.from({ length: 24 }, (_, i) => ({
        kind: "storefront_view" as const,
        storefrontId,
        daysAgo: (i % 12) + 1,
      })),
    );

    await page.goto("/analytics");
    const trend = page.locator(
      '[data-analytics-section="storefront_view"] [data-analytics-panel="trend"]',
    );
    await expect(trend).toBeVisible({ timeout: 20_000 });

    const surface = trend.locator(".recharts-wrapper").first();
    // The views section sits well below the fold. boundingBox reports viewport
    // coordinates, so without this the pointer would be aimed off-screen and
    // the chart would never see a hover at all.
    await surface.scrollIntoViewIfNeeded();
    const plot = await surface.boundingBox();
    expect(plot, "no plot to hover").toBeTruthy();
    const pointer = {
      x: plot!.x + plot!.width * 0.6,
      y: plot!.y + plot!.height * 0.5,
    };

    const wrapper = trend.locator(".recharts-tooltip-wrapper").first();
    // Recharts opens on a MOVE, so the pointer has to travel: a single
    // positioning event lands with no delta and the chart never reacts. Retried
    // because in the dev stack the chart may still be hydrating on first hover.
    await expect(async () => {
      await page.mouse.move(pointer.x - 24, pointer.y);
      await page.mouse.move(pointer.x, pointer.y, { steps: 4 });
      await expect(wrapper).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Measured immediately, with no settling wait: if it were animating, it
    // would still be somewhere near the plot's origin at this moment. It is
    // asserted to be near the POINTER instead, which is only true of a
    // readout that was placed rather than flown.
    const box = await wrapper.boundingBox();
    expect(box, "no tooltip box").toBeTruthy();
    expect(
      Math.abs(box!.x - pointer.x),
      "the readout is not at the pointer horizontally",
    ).toBeLessThan(plot!.width / 3);
    expect(
      Math.abs(box!.y - pointer.y),
      "the readout is not at the pointer vertically",
    ).toBeLessThan(plot!.height / 2);

    // And it wins against the cards around it. Without a z-index the readout
    // loses to any later sibling on DOM order alone and slides under the next
    // chart down the page.
    expect(
      await wrapper.evaluate((el) => getComputedStyle(el).zIndex),
    ).toBe("40");
  });

  test("the signal stream is not reachable with the anon key", async ({ page }) => {
    // Same guarantee 07-rest-security makes for the rest of the schema, made
    // here too because this table is written by a PUBLIC route: if anon could
    // insert, a seller's numbers would be whatever a stranger posted.
    const user = freshUser("sigrest");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedSignals(sellerId, [{ kind: "storefront_view", daysAgo: 1 }]);

    const read = await anonRest("/storefront_signals?select=id");
    // 401/403 outright, or an RLS-filtered empty list. Never a row.
    if (read.status === 200) expect(read.json).toEqual([]);
    else expect(read.status).toBeGreaterThanOrEqual(400);
  });
});
