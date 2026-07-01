"use client";

import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle. Leaves room on the right for the eye
 * button and swaps the input type between "password" and "text".
 */
export function PasswordInput({ className, ...props }: InputProps) {
  const [show, setShow] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        className={cn("pr-12", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        suppressHydrationWarning
        className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-400 transition-colors hover:text-acid focus-visible:outline-none focus-visible:text-acid"
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.7 5.1A9.4 9.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.16 3.19" />
      <path d="M6.6 6.6A13.2 13.2 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 4.9-1.38" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}
