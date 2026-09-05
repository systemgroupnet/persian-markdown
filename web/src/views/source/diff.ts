/**
 * A single replace-range edit: delete `[from, to)` from the old text and
 * insert `insert` in its place. Offsets are UTF-16 code units, matching
 * `TextChange` in views/types.ts.
 */
export interface Replacement {
  from: number;
  to: number;
  insert: string;
}

/**
 * Computes the minimal single-region replacement that turns `oldText` into
 * `newText`, by trimming the common prefix and common suffix — the same
 * trim PLAN.md §5.2 describes for the WYSIWYG bridge ("O(n), and exactly
 * right for the single-keystroke case that is 95% of edits"). Used here to
 * reconcile an externally-driven `value` change into the CodeMirror
 * document without replacing the whole doc, so the local cursor and scroll
 * position survive (PLAN.md §5.2, §5.8).
 *
 * Returns `null` when the two strings are identical (nothing to do).
 *
 * Both inputs are plain JS strings, so every index here is a UTF-16 code
 * unit — exactly the unit `TextChange` and CodeMirror both use; no byte
 * conversion happens in this module (that is the session layer's job, see
 * views/types.ts). The trim is careful never to land inside a surrogate
 * pair: if the naive common-prefix/suffix boundary would split one, it
 * backs off by one unit so the whole pair falls on the "changed" side
 * instead of being torn in two.
 */
export function computeMinimalReplace(oldText: string, newText: string): Replacement | null {
  if (oldText === newText) return null;

  const maxCommon = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < maxCommon && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  // Back off if the prefix boundary would split a surrogate pair (i.e. the
  // last matched unit is a high surrogate whose low surrogate differs).
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) {
    prefix--;
  }

  const maxSuffix = maxCommon - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Same guard, from the other end: don't let the suffix boundary split a
  // pair (the first matched unit is a low surrogate whose high surrogate
  // sits in the changed region).
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) {
    suffix--;
  }

  return {
    from: prefix,
    to: oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
