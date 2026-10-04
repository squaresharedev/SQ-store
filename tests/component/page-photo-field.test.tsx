import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { PagePhotoField } from "@/components/storefront/PagePhotoField";

afterEach(cleanup);

const KEY = "images/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa-bg.webp";

function mount(photo?: { key: string; overlay?: boolean }) {
  const onChange = vi.fn();
  render(<PagePhotoField photo={photo} url={null} onChange={onChange} onUrl={() => {}} />);
  return onChange;
}

describe("PagePhotoField", () => {
  it("offers no overlay choice until there is a photo", () => {
    mount();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("turns the overlay off by storing it, and back on by storing nothing", async () => {
    const user = userEvent.setup();
    const off = mount({ key: KEY });
    await user.click(screen.getByRole("switch", { name: "Color overlay" }));
    expect(off).toHaveBeenCalledWith({ key: KEY, overlay: false });
    cleanup();

    const on = mount({ key: KEY, overlay: false });
    expect(screen.getByRole("switch", { name: "Color overlay" })).not.toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Color overlay" }));
    expect(on).toHaveBeenCalledWith({ key: KEY });
  });

  it("removes the photo", async () => {
    const user = userEvent.setup();
    const onChange = mount({ key: KEY });
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
