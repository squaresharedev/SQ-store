/**
 * A red asterisk beside a required field's label.
 *
 * Visual only: the input it sits beside carries `required` or
 * `aria-required` for assistive tech, so this mark is `aria-hidden` rather
 * than doubling up the announcement.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}
