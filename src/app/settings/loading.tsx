import { Spinner } from "@/components/ui/spinner";

/** Section-switch loading state inside the settings shell. */
export default function SettingsLoading() {
  return (
    <div className="flex min-h-64 items-center justify-center text-neutral-400">
      <Spinner className="size-5" />
      <span className="sr-only">Loading settings…</span>
    </div>
  );
}
