"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconTileClass } from "@/components/ui/surface-styles";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
} from "@/components/ui/control-styles";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_MAX_BYTES } from "@/lib/validation/product";
import { DOCUMENT_LABEL_MAX, DOCUMENTS_MAX } from "@/types/product";
import type { DocumentFormValue } from "./form-values";

/** PDF, and the server agrees: /api/uploads/document accepts one content type
 *  and checks the leading bytes really are `%PDF`. */
const ACCEPT = "application/pdf,.pdf";

const MAX_MB = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);

/** "safety_data_sheet_v2.pdf" -> "Safety data sheet v2" — a usable label with
 *  no typing, the way Shopify seeds a media name from the filename. The
 *  seller can still rename it; this only saves the common case. */
function labelFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^./\\]+$/, "");
  const spaced = withoutExtension.replace(/[_-]+/g, " ").trim();
  const capitalised = spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : "Document";
  return capitalised.slice(0, DOCUMENT_LABEL_MAX);
}

/**
 * Certificates of conformity, safety data sheets, manuals, spec sheets —
 * whatever a regulated or technical product needs buyers (and regulators) to
 * be able to check before they buy. Public on the product page, not gated
 * behind checkout the way the digital-download file is.
 *
 * Drop several PDFs at once; each becomes its own row, pre-labelled from its
 * filename so there is nothing to fill in before saving. Rename freely
 * afterwards — the label is what buyers see, never the filename.
 */
export function DocumentsField({
  inputId,
  documents,
  onChange,
}: {
  inputId: string;
  documents: DocumentFormValue[];
  onChange: (documents: DocumentFormValue[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const room = DOCUMENTS_MAX - documents.length;

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    if (room <= 0) {
      setError(`A product can have up to ${DOCUMENTS_MAX} documents.`);
      return;
    }
    const accepted: DocumentFormValue[] = [];
    let problem: string | null = null;
    for (const file of files.slice(0, room)) {
      if (file.type !== "application/pdf") {
        problem = "Use a PDF for certificates, manuals, and other documents.";
        continue;
      }
      // Told here rather than after the upload: the server refuses the same
      // size, and finding that out at the end of a 40 MB upload is a worse way
      // to learn it. The server check is the one that counts.
      if (file.size > DOCUMENT_MAX_BYTES) {
        problem = `"${file.name}" is too big. Documents have to be under ${MAX_MB} MB.`;
        continue;
      }
      accepted.push({
        localId: crypto.randomUUID(),
        key: null,
        file,
        fileName: file.name,
        label: labelFromFileName(file.name),
      });
    }
    if (files.length > room) {
      problem = `Only ${room} more document${room === 1 ? "" : "s"} fit.`;
    }
    setError(problem);
    if (accepted.length > 0) onChange([...documents, ...accepted]);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(files);
  }

  function updateLabel(localId: string, label: string) {
    onChange(documents.map((doc) => (doc.localId === localId ? { ...doc, label } : doc)));
  }

  function remove(localId: string) {
    onChange(documents.filter((doc) => doc.localId !== localId));
  }

  return (
    <div className="space-y-4">
      {documents.length > 0 && (
        <ul className="space-y-2" aria-label="Documents">
          {documents.map((document) => (
            <li
              key={document.localId}
              className="flex items-center gap-3 rounded-sm border border-border p-3"
              data-document-row=""
            >
              <span className={cn(iconTileClass, "size-10 shrink-0")}>
                <FileText className="size-5 text-foreground" strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  type="text"
                  value={document.label}
                  maxLength={DOCUMENT_LABEL_MAX}
                  aria-label="Document name, shown to buyers"
                  placeholder="e.g. Safety Data Sheet"
                  onChange={(event) => updateLabel(document.localId, event.target.value)}
                  className={cn(fieldBaseClass, "py-1.5 text-sm")}
                />
                {document.fileName && (
                  <p className={cn(helpTextClass, "truncate")}>
                    {document.fileName}
                    {document.file ? ` · ${formatBytes(document.file.size)}` : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                className={cn(iconButtonClass, "size-8 shrink-0")}
                aria-label={`Remove ${document.label || "document"}`}
                onClick={() => remove(document.localId)}
              >
                <X className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          if (room <= 0) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-sm border border-dashed bg-background px-4 py-4 transition-colors duration-base ease-standard motion-reduce:transition-none",
          "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
          room <= 0
            ? "cursor-not-allowed border-border opacity-50"
            : dragging
              ? "border-foreground bg-accent"
              : "border-border hover:bg-accent",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          data-product-field="documents"
          type="file"
          accept={ACCEPT}
          multiple
          disabled={room <= 0}
          className="sr-only"
          onChange={handleChange}
        />
        <span className={cn(iconTileClass, "size-10")}>
          <Upload className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-inter text-sm text-foreground">
            {room <= 0 ? "Limit reached" : "Drop PDFs or click to upload"}
          </span>
          <span className="block font-inter text-xs text-muted-foreground">
            {documents.length} of {DOCUMENTS_MAX} documents · PDF, up to {MAX_MB} MB each
          </span>
        </span>
      </label>
      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
