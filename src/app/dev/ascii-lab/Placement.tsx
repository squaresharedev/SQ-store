"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { McpAddressSlab } from "@/components/settings/McpAddressSlab";
import { buttonClassName } from "@/components/ui/button";
import { GradientAscii } from "@/components/ui/GradientAscii";
import { cn } from "@/lib/utils";
import type { LabPlacement, LabProps } from "./lab-model";

/**
 * A field drawn where it would sit on Settings > Connected apps. The slab is
 * the real McpAddressSlab. The cards are stand-ins built to SettingsCard's
 * measure (padding, type, the corner frame flush in the top-right), not the
 * real component: its corner art only shows on a wide card, and the lab's
 * tiles are narrower than the settings column.
 */

/** The corner picture's frame, as ui/CornerArt draws the family's. */
const CORNER_FRAME_CLASS = "relative block h-22 w-55 shrink-0 overflow-hidden";
/** How faint the family holds a corner picture (ui/CornerArt). */
const CORNER_FADE_CLASS = "opacity-40";
/** A band fades down into the card it crowns. */
const BAND_FADE: CSSProperties = {
  WebkitMaskImage: "linear-gradient(to bottom, #000 45%, transparent)",
  maskImage: "linear-gradient(to bottom, #000 45%, transparent)",
};

/** The page, or a black slab: what a surface means for a placement's box. */
const surfaceClass = (props: LabProps) =>
  props.surface === "dark" ? "bg-foreground text-background" : "border border-border bg-background text-foreground";

function Field({ props }: { props: LabProps }) {
  return (
    <div className="absolute inset-0">
      <GradientAscii {...props} />
    </div>
  );
}

/** The "Connect an assistant" card, with a slot for each way a field can dress it. */
function ConnectCard({
  props,
  mcpUrl,
  corner,
  band,
  backdrop,
}: {
  props: LabProps;
  mcpUrl: string;
  corner?: "faint" | "bold";
  band?: boolean;
  backdrop?: boolean;
}) {
  const t = useTranslations("Settings.connectedApps.connect");
  // A dark field is light on black: the card it dresses goes dark with it.
  const dark = props.surface === "dark" && (band || backdrop);
  return (
    <section
      className={cn(
        "relative overflow-hidden border p-6 sm:p-7",
        dark ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground",
      )}
    >
      {backdrop && <Field props={props} />}
      {band && (
        <div className="relative -mx-6 -mt-6 mb-5 h-24 sm:-mx-7 sm:-mt-7" style={BAND_FADE}>
          <Field props={props} />
        </div>
      )}
      <div className="relative flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className={cn("mt-1 text-pretty font-inter text-sm leading-relaxed", dark ? "opacity-70" : "text-muted-foreground")}>
            {t("body")}
          </p>
        </div>
        {corner && (
          <span aria-hidden className={cn(CORNER_FRAME_CLASS, "-mr-6 -mt-6 sm:-mr-7 sm:-mt-7")}>
            <span className={cn("absolute inset-0", corner === "faint" && CORNER_FADE_CLASS)}>
              <GradientAscii {...props} />
            </span>
          </span>
        )}
      </div>
      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        <code
          className={cn(
            "min-w-0 basis-full break-all rounded-sm border px-3 py-2 text-sm",
            dark ? "border-background/20 bg-background/10" : "border-border bg-muted text-foreground",
          )}
        >
          {mcpUrl}
        </code>
        <span className={buttonClassName("secondary")}>{t("copy")}</span>
      </div>
    </section>
  );
}

function Frame({ props, className, children }: { props: LabProps; className: string; children?: ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden", surfaceClass(props), className)}>
      <Field props={props} />
      {children}
    </div>
  );
}

export function Placement({ placement, props, mcpUrl }: { placement: LabPlacement; props: LabProps; mcpUrl: string }) {
  const t = useTranslations("Settings.connectedApps");
  const tPage = useTranslations("Settings.metadata.connectedApps");

  switch (placement) {
    case "corner":
      return <ConnectCard props={props} mcpUrl={mcpUrl} corner="faint" />;
    case "corner-bold":
      return <ConnectCard props={props} mcpUrl={mcpUrl} corner="bold" />;
    case "band":
      return <ConnectCard props={props} mcpUrl={mcpUrl} band />;
    case "backdrop":
      return <ConnectCard props={props} mcpUrl={mcpUrl} backdrop />;
    case "hero":
      return (
        <Frame props={props} className="h-55">
          <div className="relative flex h-full flex-col justify-end p-6 sm:p-7">
            <h1 className="text-2xl font-semibold">{tPage("title")}</h1>
            <p className={cn("mt-1 font-inter text-sm", props.surface === "dark" ? "opacity-70" : "text-muted-foreground")}>
              {t("connect.body")}
            </p>
          </div>
        </Frame>
      );
    case "slab":
      // The real slab from the MCP card, so what is tuned here is what ships.
      return <McpAddressSlab mcpUrl={mcpUrl} field={props} />;
    case "empty":
      return (
        <section className="border border-border bg-background p-6 sm:p-7">
          <h2 className="text-base font-semibold text-foreground">{t("listTitle")}</h2>
          <Frame props={props} className="mt-5 h-40">
            <p
              className={cn(
                "relative grid h-full place-items-center font-inter text-sm",
                props.surface === "dark" ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {t("empty")}
            </p>
          </Frame>
        </section>
      );
    default:
      return <Frame props={props} className="h-50" />;
  }
}
