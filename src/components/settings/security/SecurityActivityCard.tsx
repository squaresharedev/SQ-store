import { SettingsCard } from "@/components/settings/SettingsCard";
import { helpTextClass } from "@/components/ui/control-styles";

export type SecurityActivityItem = { id: string; label: string; at: string };

/**
 * Fixed to UTC and said so. This renders on the server, which has no idea
 * where the reader is, and a time that is silently in the wrong zone is worse
 * than one that is plainly labelled.
 */
function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

/**
 * The account's own security log: password changes, 2FA changes, recovery
 * codes used, wrong codes at sign-in. Read-only. Its value is the entry the
 * owner does NOT recognise.
 */
export function SecurityActivityCard({ items }: { items: SecurityActivityItem[] | null }) {
  return (
    <SettingsCard
      id="activity"
      title="Recent security activity"
      description="Changes to how you sign in, newest first. If you don't recognise something here, change your password and turn on two-factor authentication."
    >
      {items === null ? (
        <p className={helpTextClass}>Your activity couldn&rsquo;t be loaded right now.</p>
      ) : items.length === 0 ? (
        <p className={helpTextClass}>Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Recent security activity">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="font-inter text-sm text-foreground">{item.label}</span>
              <time dateTime={item.at} className="font-inter text-xs text-muted-foreground">
                {formatUtc(item.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
