"use client";

import { useEffect, useState } from "react";
import { Flag, ShieldAlert, Smartphone, Ticket, TimerOff, Trash2 } from "lucide-react";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { HeroMark } from "@/components/ui/HeroMark";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { cn } from "@/lib/utils";
import { GallerySection } from "../pricing/DevControls";
import { SPECIMENS, type Specimen } from "./specimens";

/**
 * Put on <body> while Blur is on: softens every open dialog, wherever it was
 * portalled to. Spelled here in full so Tailwind generates it.
 */
const BLUR_DIALOGS_CLASS = "[&_[role=dialog]]:blur-xs";

/** The size of the phone the Phone toggle draws, in a frame of its own so the
 *  dialog inside it really is at that width (a bottom sheet, not a card). */
const PHONE_FRAME_CLASS = "h-[844px] w-[390px] border border-border bg-background";

const GROUPS = Array.from(new Set(SPECIMENS.map((specimen) => specimen.group)));

function galleryUrl(open: string | null, blur: boolean, embed: boolean): string {
  const params = new URLSearchParams();
  if (open) params.set("open", open);
  if (blur) params.set("blur", "1");
  if (embed) params.set("embed", "1");
  const query = params.toString();
  return query ? `/dev/modals?${query}` : "/dev/modals";
}

/**
 * Every dialog in the product, openable without the state that normally leads
 * to it, with the two checks that matter:
 *
 *   BLUR   the acceptance test, literally (styles.md §8.14): blurred, can you
 *          still tell what the dialog is for? Press B while one is open.
 *   PHONE  the same dialog at a phone's width, where it is a bottom sheet.
 *
 * `?open=<id>` opens one directly and `&blur=1` blurs it, so a script can walk
 * the whole list and screenshot each. `&embed=1` is the bare view the phone
 * frame loads.
 */
export function ModalGallery({
  initialOpen,
  initialBlur,
  embed,
}: {
  initialOpen: string | null;
  initialBlur: boolean;
  embed: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [blur, setBlur] = useState(initialBlur);
  const [phone, setPhone] = useState(false);
  const specimen = SPECIMENS.find((candidate) => candidate.id === openId) ?? null;

  // The address follows what is on screen, so any state can be linked to.
  useEffect(() => {
    window.history.replaceState(null, "", galleryUrl(openId, blur, embed));
  }, [openId, blur, embed]);

  useEffect(() => {
    document.body.classList.toggle(BLUR_DIALOGS_CLASS, blur);
    return () => document.body.classList.remove(BLUR_DIALOGS_CLASS);
  }, [blur]);

  // An open dialog covers the Blur button, so B does it from the keyboard.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "b" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setBlur((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = () => setOpenId(null);
  const shown = specimen && <Shown specimen={specimen} blur={blur} onClose={close} />;

  if (embed) {
    return (
      <div className="min-h-screen bg-muted p-4" data-modal-gallery="embed">
        {shown ?? (
          <button type="button" className={secondaryButtonClass} onClick={() => setOpenId(initialOpen)}>
            Open again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pb-24" data-modal-gallery="list">
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Modals</h1>
          <p className="mt-1 max-w-3xl font-inter text-sm text-muted-foreground">
            Every dialog, opened from a fixture. The rule: blurred, you can still tell what it is for. One
            central visual, a short title, at most one sentence, one primary button.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label="Blur (B)" pressed={blur} onChange={setBlur} />
          <Toggle label="Phone" pressed={phone} onChange={setPhone} />
        </div>
      </div>

      {GROUPS.map((group) => (
        <GallerySection key={group} title={group}>
          <div className="flex flex-wrap gap-2">
            {SPECIMENS.filter((candidate) => candidate.group === group).map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === openId}
                onClick={() => setOpenId(candidate.id)}
                className={cn(secondaryButtonClass, candidate.id === openId && "border-foreground")}
                data-specimen={candidate.id}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </GallerySection>
      ))}

      <GallerySection title="Marks">
        <div className="flex flex-wrap items-end gap-6">
          <HeroMark icon={Smartphone} />
          <HeroMark icon={TimerOff} />
          <HeroMark icon={ShieldAlert} tone="danger" />
          <HeroMark icon={Flag} tone="success" />
          <HeroMark icon={Ticket} tone="danger" badge={Trash2} />
          <HeroMark icon={Smartphone} size="lg" />
          <HeroMark tone="danger" badge={Trash2} size="lg">
            <ProductThumb src="/sample-storefront/camera.webp" className="size-full" />
          </HeroMark>
          <HeroMark badge={Trash2} tone="danger">
            <ProductThumb className="size-full" />
          </HeroMark>
        </div>
      </GallerySection>

      {specimen &&
        (phone ? (
          <GallerySection title={`${specimen.label}, on a phone`}>
            <iframe
              title={`${specimen.label}, on a phone`}
              src={galleryUrl(specimen.id, blur, true)}
              className={PHONE_FRAME_CLASS}
            />
          </GallerySection>
        ) : (
          shown
        ))}
    </div>
  );
}

/** A dialog opens over the page; a page card is drawn in a frame of its own. */
function Shown({ specimen, blur, onClose }: { specimen: Specimen; blur: boolean; onClose: () => void }) {
  if (specimen.kind === "dialog") return <>{specimen.render({ onClose })}</>;
  return (
    <div className="mx-auto max-w-md px-6 py-6">
      <div
        className={cn("border border-border bg-background px-6 pt-7 pb-6 shadow-lg", blur && "blur-xs")}
        data-specimen-page={specimen.id}
      >
        {specimen.render({ onClose })}
      </div>
    </div>
  );
}

function Toggle({
  label,
  pressed,
  onChange,
}: {
  label: string;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        "border px-3 py-1.5 font-inter text-xs",
        pressed ? "border-foreground bg-accent" : "border-border",
      )}
    >
      {label}
    </button>
  );
}
