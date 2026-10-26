"use client";

import { useState, type ChangeEvent, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconTileClass } from "@/components/ui/surface-styles";

/**
 * A file picker that is also a drop target: one dashed row with an icon, a
 * line saying what to drop (or the picked file's name) and a muted line under
 * it. Shared by the product and review importers. `bold` is for a page where
 * dropping the file is THE step (the review import), so the outline is a
 * heavy dotted black instead of a hairline.
 */
export function FileDropzone({
  id,
  accept,
  label,
  meta,
  bold = false,
  onFile,
}: {
  id: string;
  accept: string;
  /** "Drop a CSV here", or the picked file's name. */
  label: string;
  /** The muted line: limits before a pick, the file's size after. */
  meta: string;
  bold?: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    onFile(event.dataTransfer.files?.[0]);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    event.target.value = "";
    onFile(picked);
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-sm bg-background px-4 py-5 transition-colors duration-base ease-standard motion-reduce:transition-none",
        "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
        bold ? "border-3 border-dotted" : "border border-dashed",
        dragging ? "border-foreground bg-accent" : bold ? "border-foreground hover:bg-accent" : "border-border hover:bg-accent",
      )}
    >
      <input id={id} type="file" accept={accept} className="sr-only" onChange={handleChange} />
      <span className={cn(iconTileClass, "size-10")}>
        <Upload className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-inter text-sm text-foreground">{label}</span>
        <span className="block font-inter text-xs text-muted-foreground">{meta}</span>
      </span>
    </label>
  );
}
