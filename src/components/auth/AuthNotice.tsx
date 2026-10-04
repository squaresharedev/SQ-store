import type { ReactNode } from "react";
import { AuthBackButton } from "@/components/auth/AuthBackButton";
import { helpTextClass } from "@/components/ui/control-styles";
import { authHeadingClass } from "@/components/ui/surface-styles";

/**
 * Where a sign-in step ends up, or a dead end on the way: a mark that says
 * which (styles.md §8.14), a heading, one sentence, and at most one thing to
 * do about it. Every such state is this, so "expired", "denied" and "approved"
 * read as the same family at a glance.
 *
 * Server-compatible. `live` announces the sentence as a status, for a state
 * the person just caused (approved, denied) and did not navigate to.
 */
export function AuthNotice({
  visual,
  heading,
  body,
  live = false,
  back = false,
  attributes,
  children,
}: {
  /** A HeroMark, or the SuccessMark for the one that went through. */
  visual: ReactNode;
  heading: string;
  body: string;
  live?: boolean;
  /** A dead end the person must be able to leave: adds a Back button (to where
   *  they were, or the dashboard) below the one way on. */
  back?: boolean;
  attributes?: Record<`data-${string}`, string>;
  /** The one way on: a link or a button, full width. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center" {...attributes}>
      {visual}
      <div>
        <h1 className={authHeadingClass}>{heading}</h1>
        <p role={live ? "status" : undefined} className={`${helpTextClass} mt-1`}>
          {body}
        </p>
      </div>
      {(children || back) && (
        <div className="flex w-full flex-col gap-2">
          {children}
          {back && <AuthBackButton />}
        </div>
      )}
    </div>
  );
}
