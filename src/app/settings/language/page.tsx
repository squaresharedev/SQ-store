import { redirect } from "next/navigation";
import { LANGUAGE_SETTINGS_PATH } from "@/lib/dashboard/paths";

/** The language picker is a card on Account now; old links land on it. */
export default function LanguageSettingsPage() {
  redirect(LANGUAGE_SETTINGS_PATH);
}
