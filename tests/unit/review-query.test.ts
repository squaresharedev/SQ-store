// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseReviewQuery } from "@/lib/validation/reviews";

/**
 * The public review feed's query, as a product page's star filter sends it.
 * Read leniently: a bad value means "every rating", never an error page.
 */

const parse = (query: string) => parseReviewQuery(new URLSearchParams(query));

describe("parseReviewQuery rating", () => {
  it("narrows to a star rating on the scale", () => {
    expect(parse("rating=1").rating).toBe(1);
    expect(parse("rating=5&sort=lowest&page=2")).toMatchObject({ rating: 5, sort: "lowest", page: 2 });
  });

  it.each(["", "rating=0", "rating=6", "rating=4.5", "rating=five", "rating=-1"])("reads %j as every rating", (query) => {
    expect(parse(query)).not.toHaveProperty("rating");
  });
});
