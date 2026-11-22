// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontConfig } from "@/types/storefront";

/**
 * The storefront tools as an assistant meets them: what get_schema tells it
 * about the editor upgrade's fields, what edit_storefront's description and
 * input cost and say, and what the edit handler refuses before a save.
 */

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const OWNED = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const stored = vi.hoisted(() => ({ config: null as unknown, saves: [] as unknown[] }));
vi.mock("@/lib/storefront/queries", () => ({
  getStorefront: vi.fn(async (id: string) =>
    id === "11111111-1111-4111-8111-111111111111" ? { id, name: "Fireside", version: "v1", config: stored.config } : null,
  ),
  listStorefronts: vi.fn(),
  getShippingChoices: vi.fn(),
}));
vi.mock("@/lib/storefront/actions", () => ({
  saveStorefront: vi.fn(async (_id: string, input: { config: unknown }) => {
    stored.saves.push(input.config);
    return { ok: true, droppedBlocks: 0, version: "v2" };
  }),
  createStorefront: vi.fn(),
  deleteStorefront: vi.fn(),
  rotateEmbedKey: vi.fn(),
  updateEmbedSettings: vi.fn(),
}));
// Only reached for an upload: handle, which these edits do not carry.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
/** The store's products, as row level security would let the grant read them. */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: ids.filter((id) => id === "22222222-2222-4222-8222-222222222222").map((id) => ({ id })),
            error: null,
          }),
        }),
      }),
    }),
  })),
}));

const { findTool } = await import("@/lib/agent/tools");
const { ToolFailure } = await import("@/lib/agent/tool");
const call = { account: { accountId: ACCOUNT, userId: ACCOUNT, role: "owner", isOwner: true }, grantId: ACCOUNT } as never;

beforeEach(() => {
  stored.config = structuredClone(DEFAULT_STOREFRONT_CONFIG);
  stored.saves = [];
});

async function edit(operations: unknown[]) {
  return findTool("edit_storefront")!.handler({ id: STOREFRONT, operations } as never, call) as Promise<{
    added: string[];
    board: Record<string, unknown>;
  }>;
}

/** The refusal an edit ends in, as the assistant reads it. */
async function refusal(operations: unknown[]): Promise<string> {
  try {
    await edit(operations);
  } catch (error) {
    expect(error).toBeInstanceOf(ToolFailure);
    const failure = (error as InstanceType<typeof ToolFailure>).error as unknown as { message: unknown; fix?: unknown };
    return JSON.stringify([failure.message, failure.fix]);
  }
  throw new Error("expected a refusal");
}

describe("get_schema of storefront_config", () => {
  it("shows every field and block of the editor upgrade, with the words that steer toward presets", async () => {
    const schema = JSON.stringify(await findTool("get_schema")!.handler({ of: "storefront_config" } as never, call));
    for (const field of [
      '"palette"',
      '"fontPairing"',
      '"textStyles"',
      '"motion"',
      '"texture"',
      '"cardColor"',
      '"whiteBlend"',
      '"titleBarColor"',
      '"photoShape"',
      '"shadow"',
      '"valign"',
      '"fine"',
      '"bands"',
      '"logo"',
      '"links"',
      '"gradient"',
      '"via"',
      '"const":"button"',
      '"const":"marquee"',
    ]) {
      expect(schema, field).toContain(field);
    }
    expect(schema).toContain("Prefer this to `font`");
    expect(schema).toContain("Take every colour you set anywhere on this storefront from here");
  });
});

describe("edit_storefront as a tool", () => {
  const tool = () => findTool("edit_storefront")!;

  it("steers toward the palette, pairings and saved styles in fewer words than it used to take", () => {
    const { description } = tool();
    // It was 3,152 characters before the upgrade; it is paid for on every call.
    expect(description.length).toBeLessThan(3_152);
    expect(description.indexOf("`palette`")).toBeLessThan(description.indexOf("fontPairing"));
    expect(description).toMatch(/textStyles/);
    expect(description).toMatch(/half cells/);
  });

  it("offers every new operation in its input", () => {
    const input = JSON.stringify(z.toJSONSchema(tool().input, { io: "input" }));
    for (const op of ["add_button", "add_marquee", "add_band", "edit_band", "remove_band", "palette"]) {
      expect(input, op).toContain(`"const":"${op}"`);
    }
  });

  it("saves bands, buttons and a palette, and answers with the board as it now stands", async () => {
    const result = await edit([
      { op: "palette", colors: { accent: "#b45309" } },
      { op: "add_band", y: 0, h: 2 },
      { op: "add_product", productId: OWNED },
      { op: "add_button", label: "Shop", link: { kind: "product", productId: OWNED } },
    ]);
    expect(stored.saves).toHaveLength(1);
    const saved = stored.saves[0] as StorefrontConfig;
    expect(saved.bands).toHaveLength(1);
    expect(saved.theme.palette).toMatchObject({ accent: "#b45309" });
    expect(result.board).toMatchObject({ palette: { accent: "#b45309" }, bands: [{ y: 0, h: 2 }] });
    expect(result.added).toHaveLength(3);
  });

  it("refuses a product that is not this store's by its id, rather than letting the save drop it", async () => {
    expect(await refusal([{ op: "add_product", productId: FOREIGN }])).toContain(FOREIGN);
    expect(stored.saves).toHaveLength(0);
  });

  it("passes a link refusal on in words the assistant can act on", async () => {
    const words = await refusal([{ op: "add_button", label: "Go", link: { kind: "product", productId: OWNED } }]);
    expect(words).toContain("not on this storefront");
    expect(words).toContain("add_product");
  });

  it("explains a band past the board's last row like a block past it", async () => {
    expect(await refusal([{ op: "add_band", y: 5, h: 3 }])).toContain("for blocks and bands alike");
  });
});
