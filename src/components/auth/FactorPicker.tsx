"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type FactorChoice = { id: string; name: string };

/**
 * Which authenticator the code is from, for the (rare) account with more than
 * one. Renders nothing for a single authenticator, where there is no choice to
 * make and the server defaults to it.
 *
 * The chosen id rides in a hidden field, because Select is a styled listbox
 * with no form value of its own. The server re-checks it against the
 * account's own factors; this list is a convenience, not an authority.
 */
export function FactorPicker({
  factors,
  name,
  id,
}: {
  factors: FactorChoice[];
  /** Form field name for the chosen factor id. */
  name: string;
  id: string;
}) {
  const [value, setValue] = React.useState(factors[0]?.id ?? "");
  if (factors.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Authenticator</Label>
      <Select
        id={id}
        value={value}
        onChange={setValue}
        options={factors.map((factor) => ({ value: factor.id, label: factor.name }))}
      />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
