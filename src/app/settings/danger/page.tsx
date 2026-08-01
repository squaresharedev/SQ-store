import type { Metadata } from "next";
import { DangerZone } from "@/components/settings/DangerZone";
import { requireProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Danger zone",
};

export default async function DangerSettingsPage() {
  await requireUser("/settings/danger");
  const profile = await requireProfile();

  return (
    <DangerZone deletionRequestedAt={profile?.deletion_requested_at ?? null} />
  );
}
