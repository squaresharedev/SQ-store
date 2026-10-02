import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  errorTextClass,
  fieldBaseClass,
  infoTextClass,
  panelCaptionClass,
  panelEyebrowClass,
  panelSettingClass,
} from "@/components/ui/control-styles";

/** The share of a text's limit left at which "N characters left" appears.
 *  Above it the count is noise; the field's maxLength still holds. */
const CHARS_LEFT_SHOWN_BELOW = 0.2;

/**
 * THE DESIGN PANEL'S LAYOUT PRIMITIVES: three shapes a setting can take, so
 * every section is built from the same few pieces and reads the same way.
 * The type ladder they apply is documented with its tokens in
 * components/ui/control-styles.ts (panelEyebrowClass and friends).
 *
 *   PanelGroup  a run of related controls under a small eyebrow;
 *   PanelRow    one line: the setting on the left, its control on the right
 *               (a switch, a short segmented choice, a small preview);
 *   PanelField  a quiet caption over a control that needs the full width
 *               (a colour row, a slider, a text field, a select).
 *
 * An explanation a seller only sometimes needs rides beside the name as an
 * InfoTip (`info`), never as a paragraph under the control.
 */

type Info = { label: string; content: ReactNode };

function Name({
  text,
  htmlFor,
  className,
  info,
}: {
  text: string;
  htmlFor?: string;
  className: string;
  info?: Info;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={cn(className, "truncate")}>
          {text}
        </label>
      ) : (
        <span className={cn(className, "truncate")}>{text}</span>
      )}
      {info && <InfoTip label={info.label}>{info.content}</InfoTip>}
    </span>
  );
}

/** A run of related controls, under an eyebrow when it has a name. */
export function PanelGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="space-y-3" data-panel-group={title ?? ""}>
      {title && <p className={panelEyebrowClass}>{title}</p>}
      {children}
    </div>
  );
}

/** One line: the setting, then its control flush right. */
export function PanelRow({
  label,
  htmlFor,
  info,
  children,
}: {
  label: string;
  /** The control's id, when it is a labellable element (a switch, an input). */
  htmlFor?: string;
  info?: Info;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <Name text={label} htmlFor={htmlFor} className={panelSettingClass} info={info} />
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A caption over a line (or a few lines) of the seller's own words. What is
 * wrong with them shows under the field as they type; how much room is left
 * shows only once it is running out, since a counter that is always there is
 * a line of noise under every field.
 */
export function PanelTextField({
  id,
  label,
  value,
  max,
  multiline = false,
  placeholder,
  problem,
  charsLeft,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  multiline?: boolean;
  placeholder?: string;
  /** What is wrong with the words, said as they are typed; null when nothing. */
  problem?: string | null;
  /** "N characters left", in the reader's language. */
  charsLeft: (left: number) => string;
  onChange: (value: string) => void;
}) {
  const shared = {
    id,
    value,
    maxLength: max,
    placeholder,
    "aria-invalid": Boolean(problem),
    className: fieldBaseClass,
  };
  const left = max - value.length;
  return (
    <PanelField label={label} htmlFor={id}>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...shared} type="text" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      )}
      {problem ? (
        <p className={errorTextClass}>{problem}</p>
      ) : (
        left <= max * CHARS_LEFT_SHOWN_BELOW && <p className={infoTextClass}>{charsLeft(left)}</p>
      )}
    </PanelField>
  );
}

/** A caption over a full-width control, with room on its right (`aside`) for a
 *  reset or a status such as "Auto". */
export function PanelField({
  label,
  htmlFor,
  info,
  aside,
  children,
}: {
  label: string;
  htmlFor?: string;
  info?: Info;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Name text={label} htmlFor={htmlFor} className={panelCaptionClass} info={info} />
        {aside}
      </div>
      {children}
    </div>
  );
}
