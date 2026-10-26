import { describe, expect, it } from "vitest";
import { detectCarrier } from "@/lib/orders/carriers";

describe("detectCarrier", () => {
  it("reads a national post from an international (S10) number's country", () => {
    expect(detectCarrier("RR123456789IE")).toBe("an-post");
    expect(detectCarrier("rr 1234 5678 9gb")).toBe("royal-mail");
    expect(detectCarrier("CP123456789CZ")).toBe("ceska-posta");
  });

  it("reads UPS from its 1Z numbers", () => {
    expect(detectCarrier("1Z999AA10123456784")).toBe("ups");
  });

  it("guesses nothing for a number that does not name its carrier", () => {
    expect(detectCarrier("00340434161094042557")).toBeNull();
    expect(detectCarrier("RR123456789US")).toBeNull();
    expect(detectCarrier("")).toBeNull();
  });
});
