import { hasOptionDetails } from "@/lib/products/option-details";
import type { ProductDetails, ProductOptionGroup } from "@/types/product";

/** Trim a measure for display: 2 decimals at most, no trailing zeros. */
function measure(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/** The rows a product's details produce, or none. */
export function specRows(details: ProductDetails): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const dims = details.dimensions;
  if (dims && (dims.length !== undefined || dims.width !== undefined || dims.height !== undefined)) {
    const parts = [dims.length, dims.width, dims.height]
      .filter((part): part is number => part !== undefined)
      .map(measure);
    const named =
      parts.length === 3
        ? `${parts[0]} × ${parts[1]} × ${parts[2]} ${dims.unit}`
        : [
            dims.length !== undefined ? `L ${measure(dims.length)}` : null,
            dims.width !== undefined ? `W ${measure(dims.width)}` : null,
            dims.height !== undefined ? `H ${measure(dims.height)}` : null,
          ]
            .filter(Boolean)
            .join(" × ") + ` ${dims.unit}`;
    rows.push({ label: "Dimensions", value: named });
  }
  if (details.weight) {
    rows.push({ label: "Weight", value: `${measure(details.weight.value)} ${details.weight.unit}` });
  }
  if (details.materials) rows.push({ label: "Materials", value: details.materials });
  if (details.origin) rows.push({ label: "Made in", value: details.origin });
  for (const spec of details.specs ?? []) rows.push({ label: spec.label, value: spec.value });
  return rows;
}

/**
 * Whether the section has anything to print, for the SERVER that decides
 * whether it exists at all. The option groups count: a product whose
 * measurements live entirely on its versions (a table sold in two sizes, with
 * nothing stated for the product itself) still has a specs table, it just
 * arrives with the pick.
 */
export function hasSpecs(
  details: ProductDetails,
  optionGroups: readonly ProductOptionGroup[] = [],
): boolean {
  return (
    specRows(details).length > 0 ||
    Boolean(details.care) ||
    (details.included?.length ?? 0) > 0 ||
    hasOptionDetails([...optionGroups])
  );
}

export function SpecsTable({
  details,
  ruleColor,
  leadingRows = [],
}: {
  details: ProductDetails;
  ruleColor: string;
  /** Printed above the measurements, and today that means which version they
   *  describe (see optionSummaryRows). */
  leadingRows?: { label: string; value: string }[];
}) {
  const rows = [...leadingRows, ...specRows(details)];
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 text-sm" data-product-specs="">
          {rows.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              className="contents [&>*]:border-t [&>*]:py-2"
              style={{ borderColor: ruleColor }}
            >
              <dt className="opacity-70" style={{ borderColor: ruleColor }}>
                {row.label}
              </dt>
              <dd className="whitespace-pre-line" style={{ borderColor: ruleColor }}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {details.included && details.included.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 font-medium">What&apos;s included</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {details.included.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {details.care && (
        <div className="text-sm">
          <p className="mb-1 font-medium">Care</p>
          <p className="whitespace-pre-line">{details.care}</p>
        </div>
      )}
    </div>
  );
}
