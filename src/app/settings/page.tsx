import { redirect } from "next/navigation";

/** /settings has no content of its own — Account is the natural landing. */
export default function SettingsIndexPage() {
  redirect("/settings/account");
}
