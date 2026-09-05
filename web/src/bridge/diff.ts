/**
 * The WYSIWYG diff bridge — local-edit half.
 *
 * PLAN.md §5.2 describes this as a byte-space diff (encode once, diff in
 * UTF-8, back the trim boundaries off to a lead byte). That is right for the
 * OT wire format, but `views/types.ts` fixes the *view* contract at UTF-16
 * code units — the unit CodeMirror, Slate and `selectionStart` all speak
 * natively — and says views must never do their own byte conversion (the
 * session layer owns that, once, via OffsetIndex). So this module is a
 * deliberate simplification of §5.2: it diffs in UTF-16 code units directly,
 * and instead of a UTF-8 lead-byte boundary it backs the trim off a UTF-16
 * surrogate pair. Same shape, different unit, correct contract.
 *
 * Algorithm: common-prefix / common-suffix trim. This is O(n) and exactly
 * right for the single keystroke that dominates real editing — a trim always
 * finds the minimal replaced span for a pure insert, delete or single-region
 * replace. It is NOT minimal for a large structural edit that touches two
 * unrelated regions of the document at once (e.g. a find-and-replace across
 * the whole doc, or reordering two paragraphs) — those collapse to one
 * replacement spanning from the first difference to the last, which is
 * correct (applying it reproduces the new text exactly) but not small. PLAN's
 * fallback for that case is `diff-match-patch`; we do not pull that
 * dependency in here (§5.2 flags it as the fallback, not the common path),
 * so a large structural edit still produces a single correct-but-coarse
 * TextChange rather than several minimal ones. Documented, not implemented —
 * see the module doc above the exported functions.
 */

import type { TextChange } from "@/views/types";

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/**
 * Compute the single TextChange that turns `oldText` into `newText`, using a
 * common-prefix/common-suffix trim in UTF-16 code units. Returns `null` when
 * the strings are identical (nothing to emit).
 *
 * The prefix/suffix boundaries are backed off so neither ever falls inside a
 * surrogate pair — see the module doc for why that matters more here than it
 * would for mostly-ASCII text: ZWNJ (`می‌روم`) is a single BMP code point (no
 * surrogate risk by itself) but sits directly adjacent to Persian letters,
 * and this codebase's test corpus also includes 4-byte emoji, which *are*
 * surrogate pairs in UTF-16 — exactly the case a naive index-based trim can
 * split.
 */
export function computeTextChange(oldText: string, newText: string): TextChange | null {
  if (oldText === newText) return null;

  const oldLen = oldText.length;
  const newLen = newText.length;
  const maxCommon = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < maxCommon && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  // Back off if the cut point falls right after a high surrogate — that
  // splits whatever pair follows in BOTH strings (the low half at `prefix`
  // may differ between old/new, but a high surrogate at prefix-1 having
  // matched means both strings begin a pair there).
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) {
    prefix--;
  }

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)
  ) {
    suffix++;
  }
  // Back off if the cut point (start of the suffix region) falls on a low
  // surrogate — that means the unit immediately before it (excluded from the
  // suffix) is its high-surrogate partner.
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldLen - suffix))) {
    suffix--;
  }

  return {
    from: prefix,
    to: oldLen - suffix,
    insert: newText.slice(prefix, newLen - suffix),
  };
}

/** Apply a TextChange to a string. Used by tests to verify the invariant that
 * matters most: `applyTextChange(old, computeTextChange(old, new)) === new`. */
export function applyTextChange(text: string, change: TextChange): string {
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}
