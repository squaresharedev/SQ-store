import { redirect } from "next/navigation";

/** The language picker is a card on Account now; old links land on it. */
export default function LanguageSettingsPage() {
  redirect("/settings/account#language");
}
