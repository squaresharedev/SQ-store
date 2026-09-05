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

import { EmbedModal } from "@/components/storefront/EmbedModal";
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

function renderModal(sf = storefront()) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <EmbedModal storefront={sf} onClose={onClose} onSaved={onSaved} />,
  );
  return { ...utils, onSaved, onClose };
}

/** The saved payload from the most recent action call. */
function savedPayload() {
  const call = updateEmbedSettingsMock.mock.calls.at(-1);
  return call?.[1] as { enabled: boolean; domains: string[] };
}

async function saveWithDomains(text: string) {
  const user = userEvent.setup();
  renderModal();
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

describe("EmbedModal - snippet", () => {
  it("shows a snippet keyed to this storefront's id", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    // Keyed by the ROTATABLE embed key, not the row id, so a leaked snippet
    // can be revoked without destroying the storefront.
    expect(dialog).toHaveTextContent(`data-squareshare-storefront="${EMBED_KEY}"`);
    expect(dialog).not.toHaveTextContent(STOREFRONT_ID);
  });

  it("shows a copy control that is disabled until embedding is configured", () => {
    // SELL-03: Copy is only meaningful once embedding is live — enabled AND at
    // least one domain set. Handing someone the snippet before that makes it
    // look ready when it cannot load anywhere. The button is always rendered so
    // the seller can see it exists; its accessible label says it cannot be used yet.
    renderModal();
    const btn = within(screen.getByRole("dialog")).getByRole("button", {
      name: /embed snippet/i,
    });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });
});

describe("EmbedModal - saving", () => {
  it("persists the enable flag", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(updateEmbedSettingsMock).toHaveBeenCalled());
    expect(updateEmbedSettingsMock.mock.calls[0][0]).toBe(STOREFRONT_ID);
    expect(savedPayload().enabled).toBe(true);
  });

  it("reports a saved state and tells the caller", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i));
    expect(onSaved).toHaveBeenCalledWith(STOREFRONT_ID, expect.objectContaining({
      domains: [],
    }));
  });

  it("adopts the stored settings when opened", () => {
    renderModal(storefront({ enabled: true, domains: ["a.com", "b.com"] }));
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText(/allowed domains/i)).toHaveValue("a.com, b.com");
  });

  it("surfaces a server refusal instead of claiming success", async () => {
    updateEmbedSettingsMock.mockResolvedValue({
      ok: false,
      error: {
        code: "rate_limited",
        message: "Too many attempts to save storefronts in a short time.",
        fix: "Wait a few minutes and try again.",
      },
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/too many attempts/i),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("EmbedModal - domain sanitization", () => {
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

describe("EmbedModal - empty allowlist", () => {
  it("warns that an enabled embed with no domains serves nowhere", () => {
    // Deny-by-default: "enabled but blank" looks like it should work and
    // silently doesn't, so the modal has to say so.
    renderModal(storefront({ enabled: true, domains: [] }));
    expect(screen.getByRole("status")).toHaveTextContent(/won't load anywhere/i);
  });

  it("drops the warning once a domain is entered", async () => {
    const user = userEvent.setup();
    renderModal(storefront({ enabled: true, domains: [] }));
    await user.type(screen.getByLabelText(/allowed domains/i), "shop.example.com");
    expect(screen.queryByText(/won't load anywhere/i)).not.toBeInTheDocument();
  });

  it("says nothing when the embed is switched off", () => {
    renderModal(storefront({ enabled: false, domains: [] }));
    expect(screen.queryByText(/won't load anywhere/i)).not.toBeInTheDocument();
  });
});

describe("EmbedModal - key rotation", () => {
  it("confirms before rotating, since every pasted snippet breaks", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));

    expect(rotateEmbedKeyMock).not.toHaveBeenCalled();
    expect(screen.getByText(/stops working immediately/i)).toBeInTheDocument();
  });

  it("cancelling leaves the key alone", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(rotateEmbedKeyMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(EMBED_KEY);
  });

  it("swaps the snippet to the new key on confirm", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    const confirm = screen.getAllByRole("button", { name: /rotate key/i }).at(-1)!;
    await user.click(confirm);

    await waitFor(() => expect(rotateEmbedKeyMock).toHaveBeenCalledWith(STOREFRONT_ID));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(NEW_KEY),
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(EMBED_KEY);
  });

  it("reports a failed rotation separately from the settings save", async () => {
    rotateEmbedKeyMock.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_denied",
        message: "Your Viewer role can't edit storefronts in this store.",
        fix: "Ask the store owner to change your role.",
      },
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /rotate key/i }));
    await user.click(screen.getAllByRole("button", { name: /rotate key/i }).at(-1)!);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can't edit storefronts/i),
    );
    // The old key is still shown: nothing was rotated.
    expect(screen.getByRole("dialog")).toHaveTextContent(EMBED_KEY);
  });
});
