/**
 * Verifies that ExtendMessages performs a deep merge of parent and section
 * messages, so subtrees from both sources are preserved when they share a
 * top-level namespace key.
 *
 * The shallow-merge bug: if parent has { Errors: { stepUp: ... } } and child
 * has { Errors: { products: ... } }, a shallow merge produces only
 * { Errors: { products: ... } }, losing stepUp entirely.
 */
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useMessages } from "next-intl";
import { describe, it, expect } from "vitest";
import { ExtendMessages } from "@/i18n/ExtendMessages";

/** Captures the current next-intl messages via a client component. */
function MessageCapture({ onCapture }: { onCapture: (msgs: Record<string, unknown>) => void }) {
  const msgs = useMessages() as Record<string, unknown>;
  onCapture(msgs);
  return null;
}

function renderWithMessages(parent: Record<string, unknown>, child: Record<string, unknown>) {
  let captured: Record<string, unknown> = {};
  render(
    <NextIntlClientProvider locale="en" messages={parent}>
      <ExtendMessages messages={child}>
        <MessageCapture onCapture={(m) => { captured = m; }} />
      </ExtendMessages>
    </NextIntlClientProvider>,
  );
  return captured;
}

describe("ExtendMessages deep merge", () => {
  it("preserves parent subtrees when child adds a sibling subtree", () => {
    const parent = { Errors: { stepUp: { badCode: "Bad code" }, form: { required: "Required" } } };
    const child = { Errors: { products: { notFound: "Not found" } } };
    const result = renderWithMessages(parent, child);
    expect((result.Errors as Record<string, unknown>)?.stepUp).toBeDefined();
    expect((result.Errors as Record<string, unknown>)?.form).toBeDefined();
    expect((result.Errors as Record<string, unknown>)?.products).toBeDefined();
  });

  it("child whole-namespace wins over parent subtrees", () => {
    const parent = { Settings: { team: { roles: { owner: "Owner" } } } };
    const child = { Settings: { team: { roles: { owner: "Owner" }, legal: { agree: "Agree" } }, account: { name: "Name" } } };
    const result = renderWithMessages(parent, child);
    const settings = result.Settings as Record<string, unknown>;
    expect((settings?.team as Record<string, unknown>)?.legal).toBeDefined();
    expect((settings?.team as Record<string, unknown>)?.roles).toBeDefined();
    expect(settings?.account).toBeDefined();
  });

  it("parent keys not in child are preserved", () => {
    const parent = { Common: { actions: { save: "Save" } }, Nav: { dashboard: "Dashboard" } };
    const child = { Dashboard: { overview: { addProduct: "Add product" } } };
    const result = renderWithMessages(parent, child);
    expect(result.Common).toBeDefined();
    expect(result.Nav).toBeDefined();
    expect(result.Dashboard).toBeDefined();
  });

  it("child scalar value overwrites parent scalar value", () => {
    const parent = { Common: { actions: { save: "Save" } } };
    const child = { Common: { actions: { save: "Speichern" } } };
    const result = renderWithMessages(parent, child);
    expect((result.Common as Record<string, unknown>)?.actions).toMatchObject({ save: "Speichern" });
  });
});
