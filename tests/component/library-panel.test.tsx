import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryPanel } from "@/components/storefront/LibraryPanel";
import type { StorefrontUpload } from "@/components/storefront/UploadsPanel";

/**
 * The left panel's library mode: your own uploads and the built-in shapes,
 * behind two tabs.
 *
 * The upload half is where a seller's own artwork gets on the canvas, and the
 * re-use grid is the reason it is a panel rather than a button: an element
 * block stores an object KEY, so placing one logo twice should cost one
 * upload, not two.
 */

afterEach(cleanup);

const KEY_A =
  "elements/11111111-2222-4333-8444-555555555555/aaaaaaaa-1111-4111-8111-111111111111-logo.svg";
const KEY_B =
  "elements/11111111-2222-4333-8444-555555555555/bbbbbbbb-2222-4222-8222-222222222222-mark.png";

const UPLOAD_A: StorefrontUpload = { key: KEY_A, url: "blob:a", alt: "Our logo" };
const UPLOAD_B: StorefrontUpload = { key: KEY_B, url: null, alt: "" };

function renderPanel(
  props: Partial<Parameters<typeof LibraryPanel>[0]> = {},
) {
  const handlers = {
    onTabChange: vi.fn(),
    onUpload: vi.fn(),
    onPlaceUpload: vi.fn(),
    onAddShape: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <LibraryPanel
      tab="uploads"
      uploads={[]}
      uploading={false}
      uploadProgress={0}
      canAddBlocks
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const fileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("LibraryPanel — the two halves", () => {
  it("opens on the tab it is given", () => {
    renderPanel({ tab: "shapes" });
    expect(screen.getByRole("tab", { name: "Shapes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The shape library is what is rendered, not the uploader.
    expect(screen.getByRole("button", { name: "Add hexagon" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload image/ })).toBeNull();
  });

  it("switches tabs through its owner, not internal state", async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderPanel({ tab: "uploads" });
    await user.click(screen.getByRole("tab", { name: "Shapes" }));
    expect(onTabChange).toHaveBeenCalledWith("shapes");
  });

  it("closes on its own control", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Close library panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says when the canvas is full", () => {
    renderPanel({ canAddBlocks: false });
    expect(screen.getByText("Canvas is full")).toBeInTheDocument();
  });
});

describe("LibraryPanel — uploading", () => {
  it("hands a picked file straight to its owner", () => {
    const { onUpload } = renderPanel();
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBe(file);
  });

  it("clears the input, so the same file can be retried after a failure", () => {
    renderPanel();
    const input = fileInput();
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");
  });

  it("takes a dropped file", () => {
    const { onUpload } = renderPanel();
    const file = new File(["x"], "mark.png", { type: "image/png" });
    const zone = screen.getByRole("button", { name: /Upload image/ }).parentElement!;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBe(file);
  });

  it("reports byte progress, then the server's own work", () => {
    const { unmount } = render(
      <LibraryPanel
        tab="uploads"
        uploads={[]}
        uploading
        uploadProgress={0.42}
        canAddBlocks
        onTabChange={vi.fn()}
        onUpload={vi.fn()}
        onPlaceUpload={vi.fn()}
        onAddShape={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Uploading… 42%")).toBeInTheDocument();
    unmount();

    // null = bytes are all sent and the server is sniffing/storing. A bar
    // parked at 100% would look hung through exactly that window.
    renderPanel({ uploading: true, uploadProgress: null });
    expect(screen.getByText("Processing…")).toBeInTheDocument();
  });

  it("refuses a second file while one is already uploading", () => {
    const { onUpload } = renderPanel({ uploading: true, uploadProgress: 0.5 });
    const file = new File(["x"], "mark.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("accepts SVG by extension as well as by type", () => {
    renderPanel();
    // Browsers report SVG's MIME inconsistently, so the filter carries both.
    expect(fileInput().accept).toContain("image/svg+xml");
    expect(fileInput().accept).toContain(".svg");
  });
});

describe("LibraryPanel — re-using what is already uploaded", () => {
  it("explains the empty state rather than showing a blank grid", () => {
    renderPanel();
    expect(screen.getByText(/place the same one/i)).toBeInTheDocument();
  });

  it("lists each distinct upload and places it again on click", async () => {
    const user = userEvent.setup();
    const { onPlaceUpload } = renderPanel({ uploads: [UPLOAD_A, UPLOAD_B] });
    const grid = screen.getByRole("group", { name: "Images in this storefront" });
    expect(within(grid).getAllByRole("button")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Place Our logo again" }));
    expect(onPlaceUpload).toHaveBeenCalledWith(UPLOAD_A);
  });

  it("labels an unnamed upload without inventing a description for it", () => {
    renderPanel({ uploads: [UPLOAD_B] });
    expect(
      screen.getByRole("button", { name: "Place this image again" }),
    ).toBeInTheDocument();
  });

  it("shows a placeholder, not a broken image, when a URL is unavailable", () => {
    renderPanel({ uploads: [UPLOAD_B] });
    const button = screen.getByRole("button", { name: "Place this image again" });
    expect(within(button).queryByRole("img")).toBeNull();
  });

  it("disables re-placing at the block cap", () => {
    renderPanel({ uploads: [UPLOAD_A], canAddBlocks: false });
    expect(screen.getByRole("button", { name: "Place Our logo again" })).toBeDisabled();
  });
});
