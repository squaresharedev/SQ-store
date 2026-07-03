"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Image as ImageIcon, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from "@/lib/validation/product";

// Display-image picker: drop zone + file input with a local preview. The
// selected File is handed to the parent; ProductForm uploads it to R2 on save.
// The type/size checks here are UX only — the presign endpoint re-validates
// against the same shared schema (the security boundary).
const ACCEPTED_TYPES: readonly string[] = IMAGE_CONTENT_TYPES;
const MAX_MB = IMAGE_MAX_BYTES / (1024 * 1024);

export function ImageDropzone({
  inputId,
  describedById,
  initialPreviewUrl = null,
  onFileChange,
}: {
  inputId: string;
  describedById?: string;
  initialPreviewUrl?: string | null;
  onFileChange: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(initialPreviewUrl);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The object URL we currently own, so we can revoke it and avoid a leak.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function selectFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, WEBP, GIF, or AVIF image.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Image must be under ${MAX_MB} MB.`);
      return;
    }
    setError(null);
    clearObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreview(url);
    onFileChange(file);
  }

  function handleRemove() {
    clearObjectUrl();
    setPreview(null);
    setError(null);
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
    <div>
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
            "flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed bg-background text-center transition-colors duration-180 ease-in-out motion-reduce:transition-none",
            "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
            dragging ? "border-foreground bg-accent" : "border-border hover:bg-accent",
          )}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            aria-describedby={describedById}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) selectFile(file);
            }}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview, not a remote asset.
            <img src={preview} alt="Display image preview" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 py-6">
              <UploadCloud className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              <span className="font-inter text-sm text-foreground">
                Drop an image or click to upload
              </span>
              <span className="font-inter text-xs text-muted-foreground">
                PNG, JPG, WEBP, GIF, or AVIF, up to {MAX_MB} MB
              </span>
            </span>
          )}
        </label>

        {preview && (
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Remove display image"
            className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <X className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 font-inter text-sm text-destructive">
          <ImageIcon className="mr-1 inline size-4 align-text-bottom" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
