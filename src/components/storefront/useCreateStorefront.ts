"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { usePlanLimitRedirect } from "@/components/billing/usePlanLimitRedirect";
import { createStorefront } from "@/lib/storefront/actions";
import { storefrontEditorPath } from "@/lib/storefront/paths";

/**
 * "Create storefront", in one press: the storefront is made on the spot and
 * the designer opens on it, where the look, the name and everything else are
 * chosen with the board in view. A failure is a toast; at the plan's limit the
 * plans page takes over, since a bigger plan is the way on.
 *
 * Returns the action and whether it is under way. `creating` stays set on
 * success, because the page is already leaving for the new storefront.
 */
export function useCreateStorefront() {
  const router = useRouter();
  const showActionError = useActionErrorToast();
  const toPlansFor = usePlanLimitRedirect();
  const [creating, setCreating] = useState(false);

  async function create() {
    if (creating) return;
    setCreating(true);
    const result = await createStorefront();
    if (!result.ok) {
      showActionError(result.error);
      setCreating(false);
      toPlansFor(result.error);
      return;
    }
    router.push(storefrontEditorPath(result.id));
  }

  return [create, creating] as const;
}
