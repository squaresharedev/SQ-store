import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ArrowDownAZ, CircleDot, FileEdit, ListFilter, SlidersHorizontal } from "lucide-react";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; the Popover reads it to decide
// whether to lock scroll for the mobile sheet.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

import userEvent from "@testing-library/user-event";
import { FilterMenu, type FilterMenuSection } from "@/components/ui/FilterMenu";

const STATUS = {
  label: "Status",
  defaultValue: "",
  options: [
    { value: "", label: "All statuses", icon: ListFilter },
    { value: "active", label: "Active", icon: CircleDot },
    { value: "draft", label: "Draft", icon: FileEdit },
  ],
} as const;

const SORT = {
  label: "Sort by",
  defaultValue: "default",
  options: [
    { value: "default", label: "Newest first", icon: SlidersHorizontal },
    { value: "title", label: "Name: A–Z", icon: ArrowDownAZ },
  ],
} as const;

function renderMenu({
  status = "",
  sort = "default",
  onStatus = vi.fn(),
  onSort = vi.fn(),
}: {
  status?: string;
  sort?: string;
  onStatus?: (value: string) => void;
  onSort?: (value: string) => void;
} = {}) {
  const sections: FilterMenuSection[] = [
    { ...STATUS, options: [...STATUS.options], value: status, onChange: onStatus },
    { ...SORT, options: [...SORT.options], value: sort, onChange: onSort },
  ];
  return render(
    <FilterMenu
      ariaLabel="Sort and filter products"
      restingLabel="Sort"
      sections={sections}
    />,
  );
}

const trigger = () =>
  screen.getByRole("button", { name: "Sort and filter products" });

describe("FilterMenu", () => {
  it("reads as its resting label while every group sits at its default", () => {
    renderMenu();
    expect(trigger()).toHaveTextContent("Sort");
  });

  it("offers both groups behind the one trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());

    expect(screen.getByRole("listbox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Draft/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Name: A–Z/ })).toBeInTheDocument();
  });

  it("reports the applied selections in the trigger, in panel order", () => {
    renderMenu({ status: "draft", sort: "title" });
    expect(trigger()).toHaveTextContent("Draft · Name: A–Z");
  });

  it("names only the groups that moved off their default", () => {
    renderMenu({ status: "active" });
    expect(trigger()).toHaveTextContent("Active");
    expect(trigger()).not.toHaveTextContent("Newest first");
  });

  it("stays open after a pick so the second group is one click away", async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    renderMenu({ onStatus });

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: /Draft/ }));

    expect(onStatus).toHaveBeenCalledWith("draft");
    expect(screen.getByRole("listbox", { name: "Sort by" })).toBeInTheDocument();
  });

  it("marks the selected option in each group", async () => {
    const user = userEvent.setup();
    renderMenu({ status: "active", sort: "title" });
    await user.click(trigger());

    const statusList = screen.getByRole("listbox", { name: "Status" });
    expect(within(statusList).getByRole("option", { name: /Active/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const sortList = screen.getByRole("listbox", { name: "Sort by" });
    expect(within(sortList).getByRole("option", { name: /Name: A–Z/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
