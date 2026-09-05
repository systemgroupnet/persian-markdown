/**
 * Hazard one — round-trip normalisation (PLAN.md §5.3, R3).
 *
 * `serialize(deserialize(md))` is not the identity for all markdown:
 * `_em_` becomes `*em*`, setext headings become ATX, reference links inline,
 * list markers normalise. If entering WYSIWYG silently serialized on the
 * first keystroke, the emitted operation would rewrite the ENTIRE document
 * and stomp every collaborator's work.
 *
 * This module is the pure decision logic, independent of Plate/React: given
 * the markdown that's about to be deserialized and the two serialize/
 * deserialize functions, does the round trip change anything? The caller
 * (`WysiwygView`) is responsible for actually calling this once per mount —
 * never on every remote update — and for never emitting the normalised text
 * as a change until the *user* explicitly confirms it.
 */

export interface RoundTripResult {
  /** True when `serialize(deserialize(markdown)) === markdown` — the common
   * case, safe to enter WYSIWYG mode silently. */
  stable: boolean;
  /** The round-tripped text. Equal to the input when `stable` is true;
   * otherwise this is the text that would be emitted if the user confirms
   * normalisation. */
  after: string;
}

export function checkRoundTrip<TValue>(
  markdown: string,
  deserialize: (markdown: string) => TValue,
  serialize: (value: TValue) => string,
): RoundTripResult {
  const value = deserialize(markdown);
  const after = serialize(value);
  return { stable: after === markdown, after };
}
