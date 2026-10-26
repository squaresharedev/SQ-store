import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "../setup/render";
import userEvent from "@testing-library/user-event";

const updateEmbedSettingsMock = vi.fn();
const rotateEmbedKeyMock = vi.fn();
vi.mock("@/lib/storefront/actions", () => ({
  updateEmbedSettings: (id: string, input: unknown) =>
    updateEmbedSettingsMock(id, input),
  rotateEmbedKey: (id: string) => rotateEmbedKeyMock(id),
}));

import { EmbedSettings } from "@/components/storefront/EmbedSettings";
import { permissionDenied, rateLimited } from "@/lib/errors";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

afterEach(cleanup);

const STOREFRONT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EMBED_KEY = "11111111-2222-4333-8444-555555555555";
const NEW_KEY = "99999999-8888-4777-8666-555555555555";

function storefront(embed?: { enabled: boolean; domains: string[] }) {
  return {
    id: STOREFRONT_ID,
    name: "My Store",
    blockCount: 2,
    embedKey: EMBED_KEY,
    updatedAt: "2026-08-01T00:00:00Z",
    config: {
      ...DEFAULT_STOREFRONT_CONFIG,
      ...(embed ? { embed } : {}),
    },
  } as unknown as StorefrontSummary;
}

function renderSettings(sf = storefront()) {
  const onSaved = vi.fn();
  const utils = render(
    <EmbedSettings storefront={sf} onSaved={onSaved} />,
  );
  return { ...utils, onSaved };
}

/** The saved payload from the most recent action call. */
function savedPayload() {
  const call = updateEmbedSettingsMock.mock.calls.at(-1);
  return call?.[1] as { enabled: boolean; domains: string[] };
}

async function saveWithDomains(text: string) {
  const user = userEvent.setup();
  renderSettings();
  const input = screen.getByLabelText(/allowed domains/i);
  await user.clear(input);
  if (text) await user.type(input, text);
  await user.click(screen.getByRole("button", { name: /save settings/i }));
  return user;
}

beforeEach(() => {
  updateEmbedSettingsMock.mockReset();
  updateEmbedSettingsMock.mockResolvedValue({ ok: true });
  rotateEmbedKeyMock.mockReset();
  rotateEmbedKeyMock.mockResolvedValue({ ok: true, embedKey: NEW_KEY });
});

describe("EmbedSettings - snippet", () => {
  it("shows a snippet keyed to this storefront's id", () => {
    renderSettings();
    const page = document.body;
    // Keyed by the ROTATABLE embed key, not the row id, so a leaked snippet
    // can be revoked without destroying the storefront.
    expect(page).toHaveTextContent(`data-squareshare-storefront="${EMBED_KEY}"`);
    expect(page).not.toHaveTextContent(STOREFRONT_ID);
  });

  it("shows a copy control that is disabled until embedding is configured", () => {
    // SELL-03: Copy is only meaningful once embedding is live — enabled AND at
    // least one domain set. Handing someone the snippet before that makes it
    // look ready when it cannot load anywhere. The button is always rendered so
    // the seller can see it exists; its accessible label says it cannot be used yet.
    renderSettings();
    const btn = within(document.body).getByRole("button", {
      name: /embed snippet/i,
    });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("keeps the snippet locked while the embed has no host, however it is configured", () => {
    // No NEXT_PUBLIC_EMBED_URL (a test run, and production before launch): the
    // script the snippet loads is served by nothing. Embedding switched on with
    // a domain set used to unlock Copy all the same, and a seller who followed
    // the steps pasted a dead tag.
    renderSettings(storefront({ enabled: true, domains: ["shop.example"] }));
    expect(
      within(document.body).getByRole("button", { name: /embed snippet/i }),
    ).toBeDisabled();
    // Nor a hint that says the two steps already taken will unlock it.
    expect(document.body).not.toHaveTextContent(/to unlock the copy button/i);
    expect(document.body).toHaveTextContent(/widget is in development/i);
  });
});

// The embed is offered once it has a host of its own (lib/app-url.ts
// embedOrigin). Everything above runs without one, which is the state the app
// ships in; these run with one.
describe("EmbedSettings - once the embed has a host", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "https://embed.test"));
  afterEach(() => vi.unstubAllEnvs());

  const copySnippet = () => within(document.body).getByRole("button", { name: /embed snippet/i });

  it("drops the in-development notice and points the snippet at that host", () => {
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    expect(document.body).not.toHaveTextContent(/widget is in development/i);
    expect(document.body).toHaveTextContent('src="https://embed.test/widget.js"');
  });

  it("unlocks Copy for settings that are saved, on, and name a domain", () => {
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    expect(copySnippet()).toBeEnabled();
    expect(document.body).toHaveTextContent(/sizes itself to your storefront/i);
  });

  it("offers a plain iframe for a site that removes scripts, naming the saved sites", async () => {
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    await user.click(screen.getByRole("button", { name: /iframe only/i }));
    // The site and its www. twin, as the frame will check them, sandboxed
    // as the loader would sandbox it.
    expect(document.body).toHaveTextContent(
      `src="https://embed.test/e/${EMBED_KEY}/shop.example.com/www.shop.example.com"`,
    );
    expect(document.body).toHaveTextContent(/sandbox="allow-scripts allow-same-origin/);
    expect(document.body).not.toHaveTextContent("widget.js");
    expect(document.body).toHaveTextContent(/removes scripts/i);
    expect(copySnippet()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /^script$/i }));
    expect(document.body).toHaveTextContent('src="https://embed.test/widget.js"');
  });

  it("says where the paste goes, for the builder the seller picks", async () => {
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    const picker = screen.getByRole("combobox", { name: /your site builder/i });
    expect(document.body).toHaveTextContent(/paste it into your page's html/i);
    await user.click(picker);
    await user.click(screen.getByRole("option", { name: "Wix" }));
    expect(document.body).toHaveTextContent(/embed html/i);
    expect(document.body).not.toHaveTextContent(/paste it into your page's html/i);
  });

  it("keeps Copy locked for settings that are only typed, until they are saved", async () => {
    // The frame reads what the server holds. "On, a domain typed, never saved"
    // is the easiest way to paste a snippet that shows nothing.
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("switch", { name: /show on my website/i }));
    await user.type(screen.getByLabelText(/allowed domains/i), "shop.example.com");
    expect(copySnippet()).toBeDisabled();
    expect(document.body).toHaveTextContent(/save your settings to unlock/i);

    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(copySnippet()).toBeEnabled());
    expect(document.body).not.toHaveTextContent(/save your settings to unlock/i);
  });

  it("the switch alone locks and unlocks Copy, and saves as it is flipped", async () => {
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    expect(copySnippet()).toBeEnabled();

    // Off: Copy locks at once, and the server is told the same moment, over
    // the domains it already holds.
    await user.click(screen.getByRole("switch", { name: /show on my website/i }));
    expect(copySnippet()).toBeDisabled();
    await waitFor(() =>
      expect(updateEmbedSettingsMock).toHaveBeenLastCalledWith(STOREFRONT_ID, {
        enabled: false,
        domains: ["shop.example.com"],
      }),
    );

    // On again: Copy unlocks, no Save needed.
    await user.click(screen.getByRole("switch", { name: /show on my website/i }));
    expect(copySnippet()).toBeEnabled();
    await waitFor(() =>
      expect(updateEmbedSettingsMock).toHaveBeenLastCalledWith(STOREFRONT_ID, {
        enabled: true,
        domains: ["shop.example.com"],
      }),
    );
  });

  it("flipping the switch does not publish a domain list that is only typed", async () => {
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: false, domains: ["shop.example.com"] }));
    const field = screen.getByLabelText(/allowed domains/i);
    await user.clear(field);
    await user.type(field, "typed.example.com");
    await user.click(screen.getByRole("switch", { name: /show on my website/i }));
    await waitFor(() =>
      expect(updateEmbedSettingsMock).toHaveBeenLastCalledWith(STOREFRONT_ID, {
        enabled: true,
        domains: ["shop.example.com"],
      }),
    );
  });

  it("puts the switch back, and Copy with it, when the server refuses it", async () => {
    updateEmbedSettingsMock.mockResolvedValue({ ok: false, error: permissionDenied("viewer", "editStorefronts") });
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    await user.click(screen.getByRole("switch", { name: /show on my website/i }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /show on my website/i })).toBeChecked());
    expect(copySnippet()).toBeEnabled();
  });

  it("a save that lands late never takes back what the seller typed meanwhile", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    updateEmbedSettingsMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: [] }));
    const field = screen.getByLabelText(/allowed domains/i);
    await user.type(field, "https://first.example.com/shop");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await user.clear(field);
    await user.type(field, "second.example.com");
    finish({ ok: true });
    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    await waitFor(() => expect(field).toHaveValue("second.example.com"));
  });

  it("says what is missing when nothing is set up yet", () => {
    renderSettings();
    expect(copySnippet()).toBeDisabled();
    expect(document.body).toHaveTextContent(/enable embedding and add at least one domain/i);
  });

  it("keeps Copy locked while product pages are off, and says that is why", () => {
    // Every tile opens its product page, so without them the frame draws
    // nothing (lib/storefront/embed-frame-loader.ts).
    render(
      <EmbedSettings
        storefront={storefront({ enabled: true, domains: ["shop.example.com"] })}
        onSaved={vi.fn()}
        productPagesOn={false}
      />,
    );
    expect(copySnippet()).toBeDisabled();
    expect(document.body).toHaveTextContent(/turn on product pages in the designer first/i);
  });

  it("hands over the words for the seller's own privacy policy, naming ours", () => {
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    expect(document.body).toHaveTextContent(/storefront provided by square share/i);
    expect(document.body).toHaveTextContent("https://squareshare.eu/legal/privacy-policy/");
    expect(within(document.body).getByRole("button", { name: /copy privacy text/i })).toBeEnabled();
  });

  it("explains a storefront that does not show behind a tip, only once there is a snippet to paste", () => {
    renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
    expect(within(document.body).getByRole("button", { name: /if the storefront does not show/i })).toBeInTheDocument();
    cleanup();
    renderSettings();
    expect(within(document.body).queryByRole("button", { name: /if the storefront does not show/i })).toBeNull();
  });
});

describe("EmbedSettings - saving", () => {
  it("persists the enable flag", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    expect(updateEmbedSettingsMock.mock.calls[0][0]).toBe(STOREFRONT_ID);
    expect(savedPayload().enabled).toBe(true);
  });

  it("reports a saved state and tells the caller", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderSettings();

    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i));
    expect(onSaved).toHaveBeenCalledWith(STOREFRONT_ID, expect.objectContaining({
      domains: [],
    }));
  });

  it("adopts the stored settings on load", () => {
    renderSettings(storefront({ enabled: true, domains: ["a.com", "b.com"] }));
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText(/allowed domains/i)).toHaveValue("a.com, b.com");
  });

  it("surfaces a server refusal instead of claiming success", async () => {
    updateEmbedSettingsMock.mockResolvedValue({
      ok: false,
      error: rateLimited("saveStorefronts"),
    });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/too many attempts/i),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("EmbedSettings - domain sanitization", () => {
  it("strips scheme and path from a pasted URL", async () => {
    await saveWithDomains("HTTPS://Shop.Example.com/products");
    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    expect(savedPayload().domains).toEqual(["shop.example.com"]);
  });

  it("splits, trims and dedupes a comma-separated list", async () => {
    await saveWithDomains("a.com ,  b.com , a.com");
    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    expect(savedPayload().domains).toEqual(["a.com", "b.com"]);
  });

  it("rejects a protocol-relative host rather than storing it", async () => {
    // "//evil.com" must not survive as a hostname.
    await saveWithDomains("//evil.com");
    // Everything before the first slash is empty, so nothing is stored.
    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    expect(savedPayload().domains).toEqual([]);
  });

  for (const bad of [
    "evil.com:8080", // port
    "*.evil.com", // wildcard
    "user@evil.com", // userinfo
    "evil", // no TLD
    "евил.com", // non-ASCII homograph
    "<script>.com", // markup
  ]) {
    it(`refuses ${bad} client-side, before any request`, async () => {
      await saveWithDomains(bad);
      // Blocked by the shared schema, so the action is never reached.
      expect(updateEmbedSettingsMock).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  }

  it("refuses more domains than the cap allows", async () => {
    const many = Array.from({ length: 11 }, (_, i) => `site${i}.com`).join(",");
    await saveWithDomains(many);
    expect(updateEmbedSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("normalizes the field to what was actually stored", async () => {
    // So the seller sees the canonical list, not their raw typing.
    await saveWithDomains(" HTTPS://A.com/x , a.com , B.com ");
    await waitFor(() =>
      expect(screen.getByLabelText(/allowed domains/i)).toHaveValue("a.com, b.com"),
    );
  });
});

describe("EmbedSettings - empty allowlist", () => {
  it("warns that an enabled embed with no domains serves nowhere", () => {
    // Deny-by-default: "enabled but blank" looks like it should work and
    // silently doesn't, so the modal has to say so.
    renderSettings(storefront({ enabled: true, domains: [] }));
    expect(screen.getByRole("status")).toHaveTextContent(/won't load anywhere/i);
  });

  it("drops the warning once a domain is entered", async () => {
    const user = userEvent.setup();
    renderSettings(storefront({ enabled: true, domains: [] }));
    await user.type(screen.getByLabelText(/allowed domains/i), "shop.example.com");
    expect(screen.queryByText(/won't load anywhere/i)).not.toBeInTheDocument();
  });

  it("says nothing when the embed is switched off", () => {
    renderSettings(storefront({ enabled: false, domains: [] }));
    expect(screen.queryByText(/won't load anywhere/i)).not.toBeInTheDocument();
  });
});

describe("EmbedSettings - key rotation", () => {
  it("confirms before rotating, since every pasted snippet breaks", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));

    expect(rotateEmbedKeyMock).not.toHaveBeenCalled();
    expect(screen.getByText(/stops working immediately/i)).toBeInTheDocument();
  });

  it("cancelling leaves the key alone", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(rotateEmbedKeyMock).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent(EMBED_KEY);
  });

  it("swaps the snippet to the new key on confirm", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    const confirm = screen.getAllByRole("button", { name: /rotate key/i }).at(-1)!;
    await user.click(confirm);

    await waitFor(() => expect(rotateEmbedKeyMock).toHaveBeenCalledWith(STOREFRONT_ID));
    await waitFor(() =>
      expect(document.body).toHaveTextContent(NEW_KEY),
    );
    expect(document.body).not.toHaveTextContent(EMBED_KEY);
  });

  it("reports a failed rotation separately from the settings save", async () => {
    rotateEmbedKeyMock.mockResolvedValue({
      ok: false,
      error: permissionDenied("viewer", "editStorefronts"),
    });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    await user.click(screen.getAllByRole("button", { name: /rotate key/i }).at(-1)!);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can't edit storefronts/i),
    );
    // The old key is still shown: nothing was rotated.
    expect(document.body).toHaveTextContent(EMBED_KEY);
  });

  // Switching embedding on publishes a storefront onto the open web, so the
  // publish gate applies. The action refuses it too (lib/storefront/actions.ts);
  // this is the half that keeps the seller from finding out at Save.
  describe("the publish gate", () => {
    it("bars the enable switch, and the snippet, while trader details are missing", () => {
      render(
        <EmbedSettings
          storefront={storefront({ enabled: false, domains: ["shop.example.com"] })}
          onSaved={vi.fn()}
          missingTraderDetails={["address", "email"]}
        />,
      );
      expect(
        screen.getByText(/can't embed this storefront until your seller details/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: /show on my website/i })).toBeDisabled();
      // The snippet would call an endpoint that refuses it, so it is not
      // offered either — even though a domain is configured.
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });

    it("still lets a seller switch embedding OFF when it is already on", () => {
      // The one move that remains available: a storefront whose details lapsed
      // must be pullable back, or the seller is stuck published and blocked.
      render(
        <EmbedSettings
          storefront={storefront({ enabled: true, domains: ["shop.example.com"] })}
          onSaved={vi.fn()}
          missingTraderDetails={["email"]}
        />,
      );
      expect(screen.getByRole("switch", { name: /show on my website/i })).toBeEnabled();
    });

    it("says nothing when the store may publish", () => {
      renderSettings(storefront({ enabled: true, domains: ["shop.example.com"] }));
      expect(screen.queryByText(/until your seller details/i)).toBeNull();
      expect(screen.getByRole("switch", { name: /show on my website/i })).toBeEnabled();
    });
  });
});
