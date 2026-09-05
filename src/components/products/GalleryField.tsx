"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
  infoTextClass,
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/select";
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from "@/lib/validation/product";
import {
  GALLERY_ALT_MAX,
  GALLERY_MAX,
  type ProductOptionGroup,
} from "@/types/product";
import type { GalleryFormImage } from "./form-values";

const ACCEPTED: readonly string[] = IMAGE_CONTENT_TYPES;
const MAX_MB = IMAGE_MAX_BYTES / (1024 * 1024);

/** Grouping key for a bucket: an option id, or "" for the general (shown
 *  whatever is picked) bucket — kept as a plain string so it can key a Map and
 *  React lists without a union type leaking into every helper below. */
const GENERAL = "";

/**
 * Extra product photos for the product page, bucketed by OPTION — the same
 * mental model Shopify uses: drop photos onto the version they show, rather
 * than uploading a flat pile and assigning each one afterwards. A photo in no
 * bucket goes in "Every version" and shows whatever the buyer picks.
 *
 * A bucket per option ACROSS EVERY GROUP, headed by the group it belongs to,
 * because which axis changes the photo is the seller's business: a shirt is
 * photographed per colour, an extension cable per length, a lamp in both. A
 * photo lands in exactly one bucket (see GalleryImage on why one tie and not a
 * combination), so a "Blue" photo shows for blue in every size.
 *
 * Reassigning a photo (or moving it back to "Every version") is a dropdown on
 * the photo itself, so a misdrop never means delete-and-redo. Reordering (the
 * up/down arrows) moves a photo among its OWN bucket's siblings only, because
 * that is the order ProductGallery on the live page actually uses.
 *
 * Picked files are previewed locally and uploaded on save (ProductForm owns
 * the upload). Type and size checks here are UX only; the write action
 * re-checks everything.
 */
export function GalleryField({
  inputId,
  images,
  optionGroups,
  onChange,
}: {
  inputId: string;
  images: GalleryFormImage[];
  optionGroups: ProductOptionGroup[];
  onChange: (images: GalleryFormImage[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Object URLs this field minted, revoked on unmount.
  const owned = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of owned.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const room = GALLERY_MAX - images.length;

  function addFiles(bucketId: string, files: File[]) {
    if (files.length === 0) return;
    if (room <= 0) {
      setError(`A product can have up to ${GALLERY_MAX} extra photos.`);
      return;
    }
    const accepted: GalleryFormImage[] = [];
    let problem: string | null = null;
    for (const file of files.slice(0, room)) {
      if (!ACCEPTED.includes(file.type)) {
        problem = "Use PNG, JPG, WEBP, GIF, or AVIF images.";
        continue;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        problem = `Each photo must be under ${MAX_MB} MB.`;
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      owned.current.push(previewUrl);
      accepted.push({
        localId: crypto.randomUUID(),
        key: null,
        file,
        previewUrl,
        alt: "",
        ...(bucketId !== GENERAL ? { optionId: bucketId } : {}),
      });
    }
    if (files.length > room) {
      problem = `Only ${room} more photo${room === 1 ? "" : "s"} fit.`;
    }
    setError(problem);
    if (accepted.length > 0) onChange([...images, ...accepted]);
  }

  function update(localId: string, patch: Partial<GalleryFormImage>) {
    onChange(images.map((image) => (image.localId === localId ? { ...image, ...patch } : image)));
  }

  /** Move a photo among its OWN bucket's siblings — the order that decides
   *  where it appears when that option (or "every version") is showing. */
  function moveWithinBucket(localId: string, direction: -1 | 1) {
    const bucketId = images.find((image) => image.localId === localId)?.optionId ?? GENERAL;
    const siblingIndices = images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => (image.optionId ?? GENERAL) === bucketId)
      .map(({ index }) => index);
    const position = siblingIndices.findIndex(
      (index) => images[index]!.localId === localId,
    );
    const targetPosition = position + direction;
    if (position === -1 || targetPosition < 0 || targetPosition >= siblingIndices.length) return;
    const a = siblingIndices[position]!;
    const b = siblingIndices[targetPosition]!;
    const next = images.slice();
    [next[a], next[b]] = [next[b]!, next[a]!];
    onChange(next);
  }

  function remove(localId: string) {
    onChange(images.filter((candidate) => candidate.localId !== localId));
  }

  // One bucket per option across every group, plus the shared one. `group`
  // heads the bucket so two axes with a "Small" each stay tellable apart.
  const buckets = [
    {
      id: GENERAL,
      label: optionGroups.length > 0 ? "Every version" : "Photos",
      group: undefined as string | undefined,
      swatch: undefined as string | undefined,
    },
    ...optionGroups.flatMap((optionGroup) =>
      optionGroup.options.map((option) => ({
        id: option.id,
        label: option.name || "Unnamed option",
        group: optionGroup.name || "Options",
        // Only a swatch group paints one; a chip group's colour would be a
        // decoration the buyer never sees.
        swatch: optionGroup.display === "swatch" ? option.swatch : undefined,
      })),
    ),
  ];

  const moveTargets = buckets.map((bucket) => ({
    value: bucket.id,
    label: bucket.group ? `${bucket.group}: ${bucket.label}` : "Every version",
  }));

  return (
    <div className="space-y-4" data-product-field="gallery" data-product-value={images.length}>
      {buckets.map((bucket) => {
        const photos = images.filter((image) => (image.optionId ?? GENERAL) === bucket.id);
        // Only worth a bucket of its own once there is somewhere else a photo
        // could go — with no options yet this collapses to the one list.
        if (bucket.id !== GENERAL && photos.length === 0 && room <= 0) return null;

        // Which target reads as "current" (this bucket) vs "Move to: ..." is
        // the same for every photo in the bucket, so it's built once here
        // rather than inside the per-photo map below.
        const moveOptions = moveTargets.map((target) => ({
          value: target.value,
          label: target.value === bucket.id ? target.label : `Move to: ${target.label}`,
        }));

        const heading = (
          <>
            {bucket.swatch && (
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: bucket.swatch }}
              />
            )}
            {bucket.group && (
              <span className={cn(helpTextClass, "text-xs")}>{bucket.group}:</span>
            )}
            <span className={cn(labelClass, "min-w-0 truncate text-xs")}>{bucket.label}</span>
          </>
        );

        // AN EMPTY OPTION BUCKET IS ONE SLIM ROW, not a card with a square
        // drop tile in it. There is a bucket per option now, so with a colour
        // and a size a seller met six near-empty cards stacked into a wall
        // before the section they were actually looking for. The drop target
        // is still the option's own, which is the affordance worth keeping;
        // it just costs a line until something is in it.
        if (bucket.id !== GENERAL && photos.length === 0) {
          return (
            <AddPhotoTile
              key={bucket.id}
              inputId={`${inputId}-${bucket.id}`}
              disabled={room <= 0}
              onFiles={(files) => addFiles(bucket.id, files)}
              bucketId={bucket.id}
              heading={heading}
            />
          );
        }

        return (
          <div key={bucket.id || "general"} className="rounded-sm border border-border p-3" data-gallery-bucket={bucket.id || "general"}>
            <div className="mb-3 flex items-center gap-2">
              {heading}
              <span className={cn(helpTextClass, "text-xs")}>
                {photos.length} photo{photos.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((image) => {
                const index = photos.indexOf(image);
                return (
                  <div
                    key={image.localId}
                    className="flex flex-col gap-1.5"
                    data-gallery-photo={image.localId}
                  >
                    <div className="relative aspect-square overflow-hidden rounded-sm bg-muted">
                      {image.previewUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element -- local or signed URL */
                        <img src={image.previewUrl} alt="" className="size-full object-cover" />
                      )}
                      <button
                        type="button"
                        className={cn(iconButtonClass, "absolute right-1 top-1 size-7 bg-background/90")}
                        aria-label="Remove photo"
                        onClick={() => remove(image.localId)}
                      >
                        <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      </button>
                      <div className="absolute bottom-1 right-1 flex gap-1">
                        <button
                          type="button"
                          className={cn(iconButtonClass, "size-7 bg-background/90")}
                          aria-label="Move photo earlier"
                          disabled={index === 0}
                          onClick={() => moveWithinBucket(image.localId, -1)}
                        >
                          <ChevronUp className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={cn(iconButtonClass, "size-7 bg-background/90")}
                          aria-label="Move photo later"
                          disabled={index === photos.length - 1}
                          onClick={() => moveWithinBucket(image.localId, 1)}
                        >
                          <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={image.alt}
                      maxLength={GALLERY_ALT_MAX}
                      placeholder="Alt text"
                      aria-label="Describe this photo, for people who cannot see it"
                      onChange={(event) => update(image.localId, { alt: event.target.value })}
                      className={cn(fieldBaseClass, "py-1 text-xs")}
                    />
                    {optionGroups.length > 0 && (
                      <>
                        <label htmlFor={`${inputId}-move-${image.localId}`} className="sr-only">
                          Which version this photo is shown for
                        </label>
                        <Select
                          id={`${inputId}-move-${image.localId}`}
                          value={image.optionId ?? GENERAL}
                          options={moveOptions}
                          onChange={(value) =>
                            update(image.localId, {
                              optionId: value === GENERAL ? undefined : value,
                            })
                          }
                          triggerClassName="py-1 text-xs"
                        />
                      </>
                    )}
                  </div>
                );
              })}
              <AddPhotoTile
                inputId={`${inputId}-${bucket.id || "general"}`}
                disabled={room <= 0}
                onFiles={(files) => addFiles(bucket.id, files)}
              />
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-1.5">
        <p className={cn(infoTextClass, "tabular-nums")}>
          {images.length} of {GALLERY_MAX} photos
        </p>
        <InfoTip label="How these photos are ordered">
          The display image from Media and delivery is always first. After it,
          photos show in the order they sit in here.
        </InfoTip>
      </div>
      {error && (
        <p className={cn(infoTextClass, "text-destructive")} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One bucket's upload target: a dashed drop zone that takes a drop OR a click,
 * matching ImageDropzone's drag affordance so the two photo pickers in this
 * form feel like the same control. Its own file input, so several can sit on
 * the page (one per option) without fighting over which bucket a pick lands in.
 *
 * Two shapes, same control. Inside a bucket that already has photos it is the
 * square that continues the grid. As an EMPTY option's whole bucket
 * (`heading` given) it is one slim row carrying that option's name, because
 * there is one of these per option and a stack of empty squares buries the
 * rest of the form.
 */
function AddPhotoTile({
  inputId,
  disabled,
  onFiles,
  bucketId,
  heading,
}: {
  inputId: string;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  /** Set only in the slim shape, so it still answers `[data-gallery-bucket]`. */
  bucketId?: string;
  /** The option's label. Its presence is what selects the slim shape. */
  heading?: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(files);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  }

  const slim = heading !== undefined;

  return (
    <label
      htmlFor={inputId}
      data-gallery-bucket={bucketId}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex cursor-pointer rounded-sm border border-dashed transition-colors duration-base ease-standard motion-reduce:transition-none",
        "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
        slim
          ? "items-center gap-2 px-3 py-2"
          : "aspect-square flex-col items-center justify-center gap-1 text-center",
        disabled
          ? "cursor-not-allowed border-border opacity-50"
          : dragging
            ? "border-foreground bg-accent"
            : "border-border hover:bg-accent",
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={handleChange}
      />
      <ImagePlus
        className={cn("shrink-0 text-muted-foreground", slim ? "size-4" : "size-5")}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      {heading}
      <span
        className={cn(
          "font-inter text-xs text-muted-foreground",
          // In the slim row the label leads and the prompt sits at the end,
          // so a column of these reads as a list of options rather than a
          // column of identical "Drop or click".
          slim ? "ml-auto shrink-0 pl-2" : "px-2",
        )}
      >
        {disabled ? "Limit reached" : "Drop or click"}
      </span>
    </label>
  );
}
