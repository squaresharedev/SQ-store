"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { DeviceLabel } from "@/lib/auth/device-label";

/**
 * A device as a person reads it: "Chrome on Windows". The browser and system
 * names are product names (lib/auth/device-label.ts); the sentence joining
 * them is copy, in the reader's language.
 */
export function useDeviceName(): (device: DeviceLabel) => string {
  const t = useTranslations("Auth.device");
  return React.useCallback(
    ({ browser, os }: DeviceLabel) => {
      if (browser && os) return t("browserOnOs", { browser, os });
      return browser ?? os ?? t("unknown");
    },
    [t],
  );
}
