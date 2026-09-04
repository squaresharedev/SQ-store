import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsField } from "@/components/products/DocumentsField";
import type { DocumentFormValue } from "@/components/products/form-values";
import { DOCUMENT_MAX_BYTES } from "@/lib/validation/product";
import { DOCUMENTS_MAX } from "@/types/product";

afterEach(cleanup);

function doc(overrides: Partial<DocumentFormValue> = {}): DocumentFormValue {
  return {
    localId: crypto.randomUUID(),
    key: `files/owner/${crypto.randomUUID()}-doc.pdf`,
    file: null,
    fileName: "safety_data_sheet.pdf",
    label: "Safety data sheet",
    ...overrides,
  };
}

describe("DocumentsField", () => {
  it("adds a PDF and pre-labels it from the filename, with nothing to type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DocumentsField inputId="documents" documents={[]} onChange={onChange} />);

    const input = document.getElementById("documents") as HTMLInputElement;
    const pdf = new File(["%PDF"], "ce_certificate.pdf", { type: "application/pdf" });
    await user.upload(input, pdf);

    expect(onChange).toHaveBeenCalledTimes(1);
    const [[added]] = onChange.mock.calls;
    expect(added).toHaveLength(1);
    expect(added[0].label).toBe("Ce certificate");
    expect(added[0].file).toBe(pdf);
  });

  it("refuses a non-PDF file with a clear reason, and adds nothing", () => {
    // The input's `accept` already stops a non-PDF reaching it through the
    // native picker (which is what userEvent.upload simulates, filtering
    // exactly the way a real browser does) — so the file.type check inside
    // the component only ever fires for a DROPPED file, which bypasses
    // `accept` in every real browser. Exercise that path directly.
    const onChange = vi.fn();
    render(<DocumentsField inputId="documents" documents={[]} onChange={onChange} />);

    const dropzone = document.querySelector("label[for='documents']")!;
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/use a pdf/i);
  });

  it("refuses an oversized PDF before it is uploaded, naming the file and the cap", () => {
    // The server refuses the same size (and is the check that counts); saying
    // so here means a seller does not find out at the end of a 40 MB upload.
    const onChange = vi.fn();
    render(<DocumentsField inputId="documents" documents={[]} onChange={onChange} />);

    const huge = new File(["%PDF"], "manual.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: DOCUMENT_MAX_BYTES + 1 });
    fireEvent.drop(document.querySelector("label[for='documents']")!, {
      dataTransfer: { files: [huge] },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/manual\.pdf.*too big/i);
  });

  it("renames and removes an existing document", async () => {
    const user = userEvent.setup();
    const existing = doc();
    const onChange = vi.fn();
    render(
      <DocumentsField inputId="documents" documents={[existing]} onChange={onChange} />,
    );

    // fireEvent.change, not userEvent.type: this onChange is a bare spy, not
    // wired back to state, so React resets the controlled input to its prop
    // value between keystrokes — one synthetic change with the FINAL value
    // is what actually exercises the handler once, correctly.
    const labelInput = screen.getByDisplayValue("Safety data sheet");
    fireEvent.change(labelInput, { target: { value: "SDS v2" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...existing, label: "SDS v2" }]);

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("stops accepting uploads once the cap is reached", async () => {
    const user = userEvent.setup();
    const documents = Array.from({ length: DOCUMENTS_MAX }, () => doc());
    const onChange = vi.fn();
    render(
      <DocumentsField inputId="documents" documents={documents} onChange={onChange} />,
    );

    expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
    const input = document.getElementById("documents") as HTMLInputElement;
    expect(input).toBeDisabled();
    await user
      .upload(input, new File(["%PDF"], "extra.pdf", { type: "application/pdf" }))
      .catch(() => {});
    expect(onChange).not.toHaveBeenCalled();
  });
});
