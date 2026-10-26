import { describe, expect, it } from "vitest";
import {
  buildReviewImportPlan,
  detectReviewSource,
  reviewProductKeys,
  slugKey,
  suggestProductMatches,
} from "@/lib/reviews/import";

/**
 * Reading Shopify review app exports (lib/reviews/import.ts). The fixtures
 * are the column layouts each app writes; what matters is that each one maps
 * itself, that rows the old store hid stay hidden, and that a row which would
 * not pass a buyer review's gates is reported rather than written.
 */

const NOW = Date.UTC(2026, 9, 25);

const JUDGEME = [
  "title,body,rating,review_date,source,curated,reviewer_name,reviewer_email,product_id,product_handle,reply,reply_date,picture_urls,ip_address,location,metaobject_handle",
  'Great,"Lovely, really <b>lovely</b> lamp",5,2024-03-01 10:00:00 UTC,web,ok,Aoife B.,aoife@example.com,123,linen-lamp,,,,1.2.3.4,IE,',
  "Meh,Arrived late,3,2024-03-02 11:00:00 UTC,web,ok,Ciarán,c@example.com,123,linen-lamp,,,,,,",
  "Buy now!!!,spam,5,2024-03-03 12:00:00 UTC,web,spam,Bot,bot@example.com,456,mug,,,,,,",
  "Nice,Good mug,4,2024-03-04 09:00:00 UTC,web,ok,Dana,d@example.com,456,Café Mug,,,,,,",
].join("\n");

describe("detecting the app", () => {
  it("recognises each export by the columns only it writes", () => {
    expect(detectReviewSource(["title", "body", "rating", "curated", "reviewer_name", "product_handle"])).toBe("judgeme");
    expect(detectReviewSource(["Product ID", "Review Score", "Review Content", "Display Name", "Date"])).toBe("yotpo");
    expect(detectReviewSource(["id", "rating", "nickname", "review", "date", "handle"])).toBe("loox");
    expect(detectReviewSource(["product_handle", "state", "rating", "title", "author", "body", "created_at"])).toBe("shopify");
    expect(detectReviewSource(["a", "b"])).toBeNull();
  });
});

describe("buildReviewImportPlan", () => {
  const plan = buildReviewImportPlan(JUDGEME, NOW);

  it("maps a Judge.me export by itself", () => {
    expect(plan.source).toBe("judgeme");
    expect(plan.missing).toEqual([]);
    expect(plan.rows[0]).toMatchObject({
      line: 2,
      productKey: "linen-lamp",
      rating: 5,
      title: "Great",
      // Markup from the old store becomes plain text.
      body: "Lovely, really lovely lamp",
      author: "Aoife B.",
      reviewedAt: "2024-03-01T10:00:00.000Z",
      problem: null,
    });
  });

  it("leaves out what the old store hid or flagged as spam", () => {
    expect(plan.hidden).toBe(1);
    expect(plan.rows.map((row) => row.author)).toEqual(["Aoife B.", "Ciarán", "Dana"]);
  });

  it("never reads the reviewer's email or IP address", () => {
    expect(JSON.stringify(plan.rows)).not.toMatch(/example\.com|1\.2\.3\.4/);
  });

  it("reports a row that would not pass the review gates instead of writing it", () => {
    const header = "rating,reviewer_name,review_date,product_handle,body";
    const bad = buildReviewImportPlan(
      [header, "4.5,A,2024-01-01,lamp,x", "5,,2024-01-01,lamp,x", "5,A,not a date,lamp,x", "5,A,2099-01-01,lamp,x", "5,A,2024-01-01,,x", "4.0,A,2024-01-01,lamp,"].join("\n"),
      NOW,
    );
    expect(bad.rows.map((row) => row.problem)).toEqual(["rating", "author", "date", "date", "product", null]);
    // A rating-only review is a review: imports may carry no text.
    expect(bad.rows[5]).toMatchObject({ rating: 4, body: "" });
  });

  it("names the columns a file is missing", () => {
    expect(buildReviewImportPlan("title,body\nA,B", NOW).missing).toEqual(["rating", "author", "date", "product"]);
  });
});

describe("matching products", () => {
  it("groups reviews by product key and matches each by slug", () => {
    const plan = buildReviewImportPlan(JUDGEME, NOW);
    const keys = reviewProductKeys(plan);
    expect(keys).toEqual([
      { key: "linen-lamp", slug: "linen-lamp", count: 2 },
      { key: "Café Mug", slug: "cafe-mug", count: 1 },
    ]);
    const products = [
      { id: "p-lamp", title: "Linen Lamp", identifier: null },
      { id: "p-mug", title: "Something else", identifier: "CAFE MUG" },
    ];
    expect(suggestProductMatches(keys, products)).toEqual({ "linen-lamp": "p-lamp", "cafe-mug": "p-mug" });
    expect(suggestProductMatches(keys, [])).toEqual({ "linen-lamp": null, "cafe-mug": null });
  });

  it("slugs titles and handles to the same key", () => {
    expect(slugKey("Linen Shirt (Blue)")).toBe(slugKey("linen-shirt-blue"));
    expect(slugKey("  Crème brûlée  ")).toBe("creme-brulee");
  });
});
