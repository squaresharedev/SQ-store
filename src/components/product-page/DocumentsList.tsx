import { ArrowUpRight, FileText } from "lucide-react";
import type { ProductPageDocument } from "@/types/product";

/**
 * Certificates, manuals, spec sheets: public documents a buyer (or a
 * regulator) can open before paying, never gated behind checkout. Plain
 * links, each naming its own format so a buyer knows what they are about to
 * open.
 */
export function DocumentsList({
  documents,
  ruleColor,
}: {
  documents: ProductPageDocument[];
  ruleColor: string;
}) {
  return (
    <ul className="flex flex-col text-sm" data-product-documents="">
      {documents.map((document, index) => (
        <li key={document.url} className={index > 0 ? "border-t" : undefined} style={{ borderColor: ruleColor }}>
          <a
            href={document.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-2.5 hover:underline"
          >
            <FileText className="size-4 shrink-0 opacity-70" strokeWidth={2} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{document.label}</span>
            {document.format && (
              <span className="shrink-0 rounded-sm border px-1.5 py-0.5 text-xs opacity-70" style={{ borderColor: ruleColor }}>
                {document.format}
              </span>
            )}
            <ArrowUpRight className="size-3.5 shrink-0 opacity-50" strokeWidth={2} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
