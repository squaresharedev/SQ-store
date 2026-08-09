import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "../setup/render";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

const uploadAvatarMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const removeAvatarMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/lib/settings/avatar", () => ({
  uploadAvatar: uploadAvatarMock,
  removeAvatar: removeAvatarMock,
}));

const { AvatarUpload } = await import("@/components/settings/AvatarUpload");

beforeEach(() => {
  vi.clearAllMocks();
  uploadAvatarMock.mockResolvedValue({});
  removeAvatarMock.mockResolvedValue({});
});

const PHOTO = "https://example.test/avatars/u1/avatar-1.webp";

const editButton = () =>
  screen.getByRole("button", { name: /profile photo$/i });

describe("AvatarUpload: the avatar as an edit target", () => {
  it("makes the photo itself a button that opens the editor", () => {
    render(<AvatarUpload avatarUrl={PHOTO} name="Ada Lovelace" />);
    expect(
      screen.getByRole("button", { name: "Edit your profile photo" }),
    ).toBeInTheDocument();
  });

  it("asks for an upload instead when there is no photo to edit", () => {
    render(<AvatarUpload avatarUrl={null} name="Ada Lovelace" />);
    expect(
      screen.getByRole("button", { name: "Upload a profile photo" }),
    ).toBeInTheDocument();
  });

  it("signals editing with a pencil, not a camera", () => {
    render(<AvatarUpload avatarUrl={PHOTO} name="Ada Lovelace" />);
    // A camera reads as "take a photo", which is the Change photo button's job.
    expect(editButton().querySelector(".lucide-pencil")).not.toBeNull();
    expect(editButton().querySelector(".lucide-camera")).toBeNull();
  });

  it("gives the hover overlay a box that can actually be a circle", () => {
    // The bug this pins: Avatar is an inline-flex span, so an auto-height
    // button inherits the line box's descender gap and measures 64x69. A
    // rounded-full overlay on inset-0 is then an ellipse over a circle.
    render(<AvatarUpload avatarUrl={PHOTO} name="Ada Lovelace" />);
    const button = editButton();
    expect(button.className).toContain("size-16");
    expect(button.className).toContain("rounded-full");

    const overlay = button.querySelector("span.absolute");
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain("inset-0");
    expect(overlay!.className).toContain("rounded-full");
    // Equal width and height classes are what make inset-0 a true circle.
    expect(button.className).not.toMatch(/\bh-\d/);
    expect(button.className).not.toMatch(/\bw-\d/);
  });

  it("reveals the overlay on hover and on keyboard focus alike", () => {
    render(<AvatarUpload avatarUrl={PHOTO} name="Ada Lovelace" />);
    const overlay = editButton().querySelector("span.absolute")!;
    expect(overlay.className).toContain("opacity-0");
    expect(overlay.className).toContain("group-hover/avatar:opacity-100");
    expect(overlay.className).toContain("group-focus-visible/avatar:opacity-100");
  });

  it("opens the crop modal when the existing photo is clicked", async () => {
    const user = userEvent.setup();
    render(<AvatarUpload avatarUrl={PHOTO} name="Ada Lovelace" />);

    await user.click(editButton());

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAccessibleName(/crop your photo/i),
    );
  });

  it("goes to the file picker, not the editor, when there is no photo yet", async () => {
    const user = userEvent.setup();
    render(<AvatarUpload avatarUrl={null} name="Ada Lovelace" />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    await user.click(editButton());

    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
