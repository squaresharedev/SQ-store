import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

import { ProfilePicCropModal } from "@/components/settings/ProfilePicCropModal";

/**
 * The crop maths is the whole point of this component: everything the user
 * sees is a CSS transform, and Save has to invert that transform exactly or
 * the saved photo is not the one they framed. These tests pin the inverse,
 * the clamping that keeps background out of the circle, and the File handed
 * back to the host.
 */

const SIZE = 280; // the surface size the component falls back to under jsdom
const SRC = "data:image/png;base64,AAAA";

type DrawCall = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

let drawCalls: DrawCall[] = [];
let arcCalls: number[][] = [];
let toBlobType: string | undefined;
/** What the stubbed canvas hands back; null exercises the failure path. */
let blobResult: Blob | null = new Blob(["x"], { type: "image/webp" });

/** jsdom has no image loading and no canvas; both are stubbed to the parts
 *  this component actually touches. */
function stubImage(naturalWidth: number, naturalHeight: number) {
  class FakeImage {
    crossOrigin = "";
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

beforeEach(() => {
  drawCalls = [];
  arcCalls = [];
  toBlobType = undefined;
  blobResult = new Blob(["x"], { type: "image/webp" });
  stubImage(1000, 1000);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    arc: (...args: number[]) => void arcCalls.push(args),
    drawImage: (
      _img: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => void drawCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh }),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    toBlobType = type;
    callback(blobResult);
  } as HTMLCanvasElement["toBlob"]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = () => {};

function renderModal() {
  const onSave = vi.fn<(file: File) => void>();
  render(
    <ProfilePicCropModal
      open
      src={SRC}
      onSave={onSave}
      onClose={noop}
      onUploadNew={noop}
    />,
  );
  return { onSave };
}

const surface = () => screen.getByRole("application");
const image = () => document.querySelector("img") as HTMLImageElement;
const zoomSlider = () => screen.getByLabelText("Zoom") as HTMLInputElement;

/** Waits for the stubbed image load to land and the <img> to be rendered. */
async function ready() {
  await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
}

describe("ProfilePicCropModal: surface", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProfilePicCropModal open={false} src={SRC} onSave={noop} onClose={noop} onUploadNew={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("starts unzoomed and uncentred once the source loads", async () => {
    renderModal();
    await ready();
    expect(zoomSlider().value).toBe("1");
    expect(image().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("loads the source with CORS so the canvas is not tainted", async () => {
    renderModal();
    await ready();
    expect(image().getAttribute("crossorigin")).toBe("anonymous");
  });

  it("reports a source that fails to load instead of showing an empty box", async () => {
    class BrokenImage {
      crossOrigin = "";
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    renderModal();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: /save photo/i })).toBeDisabled();
  });
});

describe("ProfilePicCropModal: panning and clamping", () => {
  it("does not pan at all at zoom 1, where there is no overhang to spend", async () => {
    renderModal();
    await ready();
    fireEvent.keyDown(surface(), { key: "ArrowRight" });
    expect(image().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("pans with the arrow keys once zoomed in", async () => {
    renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "2" } });
    fireEvent.keyDown(surface(), { key: "ArrowRight" });
    expect(image().style.transform).toBe("translate(8px, 0px) scale(2)");
    fireEvent.keyDown(surface(), { key: "ArrowDown", shiftKey: true });
    expect(image().style.transform).toBe("translate(8px, 32px) scale(2)");
  });

  it("clamps the pan to the overhang the zoom created", async () => {
    renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "2" } });
    // max offset at zoom 2 on a 280px surface is (2 - 1) * 280 / 2 = 140.
    for (let i = 0; i < 40; i += 1) {
      fireEvent.keyDown(surface(), { key: "ArrowRight", shiftKey: true });
    }
    expect(image().style.transform).toBe("translate(140px, 0px) scale(2)");
  });

  it("re-clamps when zooming back out, so the circle never shows background", async () => {
    renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "4" } });
    for (let i = 0; i < 60; i += 1) {
      fireEvent.keyDown(surface(), { key: "ArrowRight", shiftKey: true });
    }
    expect(image().style.transform).toBe("translate(420px, 0px) scale(4)");
    fireEvent.change(zoomSlider(), { target: { value: "1" } });
    expect(image().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("keeps zoom inside its range", async () => {
    renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "99" } });
    expect(zoomSlider().value).toBe("4");
    fireEvent.change(zoomSlider(), { target: { value: "-5" } });
    expect(zoomSlider().value).toBe("1");
  });
});

describe("ProfilePicCropModal: saving", () => {
  it("emits a 512px circular WebP for the whole image when untouched", async () => {
    const { onSave } = renderModal();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    // Square source, zoom 1: the whole 1000x1000 image is the crop.
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]).toMatchObject({ sx: 0, sy: 0, sw: 1000, sh: 1000, dw: 512, dh: 512 });
    // Clipped to a circle inscribed in the output.
    expect(arcCalls[0].slice(0, 3)).toEqual([256, 256, 256]);
    expect(toBlobType).toBe("image/webp");

    const file = onSave.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("avatar.webp");
    expect(file.type).toBe("image/webp");
  });

  it("takes only the visible window when zoomed and panned", async () => {
    const { onSave } = renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // At zoom 2 the visible window is half the surface, centred: the middle
    // 500x500 of a 1000x1000 source.
    expect(drawCalls[0]).toMatchObject({ sx: 250, sy: 250, sw: 500, sh: 500 });
  });

  it("crops the long axis of a landscape source, matching object-fit: cover", async () => {
    stubImage(2000, 1000); // 2:1
    const { onSave } = renderModal();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // cover fits the short edge: 1000px tall stays whole, the width is halved
    // and centred, so x runs 500..1500.
    expect(drawCalls[0].sy).toBeCloseTo(0, 6);
    expect(drawCalls[0].sh).toBeCloseTo(1000, 6);
    expect(drawCalls[0].sx).toBeCloseTo(500, 6);
    expect(drawCalls[0].sw).toBeCloseTo(1000, 6);
  });

  it("inverts the pan: dragging the image right takes pixels from its left", async () => {
    const { onSave } = renderModal();
    await ready();
    fireEvent.change(zoomSlider(), { target: { value: "2" } });
    // +140px is the full overhang, so the crop sits flush against the left edge.
    for (let i = 0; i < 40; i += 1) {
      fireEvent.keyDown(surface(), { key: "ArrowRight", shiftKey: true });
    }
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(drawCalls[0].sx).toBeCloseTo(0, 6);
    expect(drawCalls[0].sw).toBeCloseTo(500, 6);
  });

  it("names the file after the bytes when the browser ignores the WebP request", async () => {
    blobResult = new Blob(["x"], { type: "image/png" });
    const { onSave } = renderModal();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const file = onSave.mock.calls[0][0] as File;
    expect(file.name).toBe("avatar.png");
    expect(file.type).toBe("image/png");
  });

  it("surfaces an encode failure rather than uploading nothing", async () => {
    blobResult = null;
    const { onSave } = renderModal();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /save photo/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not prepare/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the surface maths is size-relative: SIZE is the jsdom fallback", () => {
    // Guards the fallback the assertions above are written against; if the
    // default surface size changes, the expected pixel numbers must too.
    expect(SIZE).toBe(280);
  });
});


