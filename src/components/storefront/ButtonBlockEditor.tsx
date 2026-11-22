"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { BUTTON_LABEL_MAX, BUTTON_LOOKS, type ButtonBlock } from "@/types/storefront";
import { BlockActions } from "./BlockActions";
import { LinkDestinationField, type LinkChoices } from "./LinkDestinationField";
import { PanelField, PanelTextField } from "./PanelField";

export type { LinkableStorefront } from "./LinkDestinationField";

/**
 * A BUTTON'S OWN PANEL: its words, where it leads, and which of the
 * storefront's three button looks it wears. Its colours are the storefront's
 * own button (the product page's), so there are none to choose here.
 */
export function ButtonBlockEditor({
  block,
  choices,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  block: ButtonBlock;
  /** Where it may lead: the board's products and bands, the store's storefronts. */
  choices: LinkChoices;
  onUpdate: (patch: Partial<Pick<ButtonBlock, "label" | "link" | "look">>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("EditorLayout.panel.button");
  const id = useId();
  // The words as typed: kept to the block only while there are some, since a
  // button with none is one the schema refuses (the panel says so instead).
  const [draftLabel, setDraftLabel] = useState(block.label);

  return (
    <div className="space-y-4" data-button-editor={block.id}>
      <PanelTextField
        id={`${id}-label`}
        label={t("label")}
        value={draftLabel}
        max={BUTTON_LABEL_MAX}
        problem={draftLabel.trim() ? null : t("labelProblem")}
        charsLeft={(left) => t("charsLeft", { n: left })}
        onChange={(label) => {
          setDraftLabel(label);
          if (label.trim()) onUpdate({ label });
        }}
      />

      <LinkDestinationField link={block.link} choices={choices} onChange={(link) => onUpdate({ link })} />

      <PanelField label={t("look")}>
        <SegmentedControl
          value={block.look ?? "solid"}
          options={BUTTON_LOOKS.map((look) => ({ value: look, label: t(`looks.${look}`) }))}
          onChange={(look) => onUpdate({ look })}
          ariaLabel={t("look")}
        />
      </PanelField>

      <BlockActions onDuplicate={onDuplicate} onRemove={onRemove} />
    </div>
  );
}
