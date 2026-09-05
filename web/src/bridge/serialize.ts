/**
 * `remark-stringify` (which `@platejs/markdown` uses under the hood)
 * unconditionally appends exactly one trailing newline to its output,
 * regardless of whether the input had one. That's a harmless file-ending
 * convention for a standalone `.md` file, but it is NOT harmless here: the
 * OT session's `value` is a bare string with no such guarantee, so without
 * this normalisation, `serialize()` would produce a phantom "append \n"
 * diff against almost every document on the very first bridge tick — and,
 * separately, would make `checkRoundTrip` (normalization.ts) fire the
 * normalisation prompt for nearly every document that doesn't happen to end
 * with a stored newline, defeating the point of that check (silent entry in
 * the common case).
 *
 * The fix: treat "exactly one trailing newline" as a serializer artifact,
 * not content, and strip it before treating the result as *the* markdown
 * string anywhere in the bridge. This is applied consistently everywhere
 * `editor.api.markdown.serialize()` is called from this view/bridge, so the
 * view's internal notion of "current markdown" never has a phantom newline
 * the outside world's `value` doesn't have.
 *
 * Deliberately narrow: only ONE trailing newline is stripped. A document
 * that genuinely ends with a blank line (two newlines) still round-trips
 * that as real content, because collapsing multiple trailing blank lines
 * *is* a meaningful (if minor) normalisation the user should see the prompt
 * for, same as list-marker or emphasis-style normalisation.
 */
export function stripSingleTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
