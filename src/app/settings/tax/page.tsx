import { permanentRedirect } from "next/navigation";
import { TRADER_IDENTITY_HREF } from "@/lib/settings/trader-identity";

// Where "Business & seller details" used to live, when the page only held the
// VAT number. Old links (emails, bookmarks, search results) still land: the
// browser keeps any #field anchor across the redirect.
export default function OldTaxSettingsPage(): never {
  permanentRedirect(TRADER_IDENTITY_HREF);
}
