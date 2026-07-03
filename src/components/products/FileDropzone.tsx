"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { FileText, FileUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DIGITAL_FILE_MAX_BYTES } from "@/lib/validation/product";
import { formatBytes } from "@/lib/format";

// Digital-file picker (the asset the buyer downloads after purchase). The
// selected File is handed to the parent; ProductForm uploads it to R2 on save.
// Type/size are enforced server-side at presign time (shared Zod schema); the
// hint below is UX only.
const MAX_MB = DIGITAL_FILE_MAX_BYTES / (1024 * 1024);

type Selected = { name: string; size: number | null };

export function FileDropzone({
  inputId,
  describedById,
  initialFileName = null,
  onFileChange,
}: {
  inputId: string;
  describedById?: string;
  initialFileName?: string | null;
  onFileChange: (file: File | null) => void;
}) {
  const [selected, setSelected] = useState<Selected | null>(
    initialFileName ? { name: initialFileName, size: null } : null,
  );
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function selectFile(file: File) {
    setSelected({ name: file.name, size: file.size });
    onFileChange(file);
  }

  function handleRemove() {
    setSelected(null);
    if (inputRef.current) inputRef.current.value = "";
    onFileChange(null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) selectFile(file);
  }

  return (
    <div className="relative">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-sm border border-dashed bg-background px-4 py-4 transition-colors duration-180 ease-in-out motion-reduce:transition-none",
          "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
          dragging ? "border-foreground bg-accent" : "border-border hover:bg-accent",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          aria-describedby={describedById}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) selectFile(file);
          }}
        />
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
          {selected ? (
            <FileText className="size-5 text-foreground" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate font-inter text-sm text-foreground">
                {selected.name}
              </span>
              <span className="block font-inter text-xs text-muted-foreground">
                {selected.size !== null ? formatBytes(selected.size) : "Current file"}
              </span>
            </>
          ) : (
            <>
              <span className="block font-inter text-sm text-foreground">
                Drop a file or click to upload
              </span>
              <span className="block font-inter text-xs text-muted-foreground">
                ZIP, PDF, and similar, up to {MAX_MB} MB
              </span>
            </>
          )}
        </span>
      </label>

      {selected && (
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remove digital file"
          className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
