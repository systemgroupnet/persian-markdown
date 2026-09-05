/**
 * UTF-8 byte arithmetic over JavaScript strings.
 *
 * Operations are measured in UTF-8 bytes (PLAN.md §3.2) but JavaScript strings
 * are UTF-16, so this module is where the two meet. It is deliberately the only
 * place in the OT engine that knows either encoding exists.
 *
 * The distinction is not academic for this product: a Persian character is 2
 * bytes but 1 UTF-16 unit, and U+200C ZWNJ — which appears inside ordinary
 * Persian words like می‌روم — is 3 bytes but still 1 unit. Getting this wrong
 * does not fail loudly; it silently shifts everybody's text by a byte or two.
 */

const encoder = new TextEncoder();
// fatal: true turns a split sequence into an exception instead of a silent
// U+FFFD, which is the difference between a caught bug and a corrupted document.
const decoder = new TextDecoder("utf-8", { fatal: true });

export class Utf8Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Utf8Error";
  }
}

/**
 * Byte length of a string when encoded as UTF-8.
 *
 * Counts without allocating, which matters because this runs on every
 * keystroke. Lone surrogates are counted as 3 bytes because that is what
 * TextEncoder emits for them (U+FFFD) — agreeing with the encoder is what keeps
 * length accounting consistent with utf8Encode.
 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++; // consume the surrogate pair
      } else {
        n += 3; // lone high surrogate becomes U+FFFD
      }
    } else {
      n += 3; // includes lone low surrogates
    }
  }
  return n;
}

/**
 * Byte length of s.slice(from, to) without materialising the slice.
 *
 * The allocation matters: this is the inner loop of offset conversion, which
 * runs on every keystroke. Rustpad's equivalent line does
 * `content.slice(0, rangeOffset)` and pays a copy of the whole document prefix
 * each time.
 */
export function utf8LengthBetween(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < to ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}

/** UTF-8 byte width of the character starting at index i. */
export function charByteWidth(s: string, i: number): { bytes: number; units: number } {
  const c = s.charCodeAt(i);
  if (c < 0x80) return { bytes: 1, units: 1 };
  if (c < 0x800) return { bytes: 2, units: 1 };
  if (c >= 0xd800 && c <= 0xdbff) {
    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, units: 2 };
    return { bytes: 3, units: 1 };
  }
  return { bytes: 3, units: 1 };
}

export function utf8Encode(s: string): Uint8Array {
  return encoder.encode(s);
}

export function utf8Decode(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch (err) {
    throw new Utf8Error(`invalid UTF-8: ${String(err)}`);
  }
}

/** Whether a byte offset is a legal split point (not inside a sequence). */
export function isBoundary(bytes: Uint8Array, at: number): boolean {
  if (at < 0 || at > bytes.length) return false;
  if (at === bytes.length) return true;
  return (bytes[at]! & 0xc0) !== 0x80;
}

/**
 * Slice a string by UTF-8 byte offsets, refusing to split a sequence.
 */
export function utf8Slice(s: string, start: number, end?: number): string {
  const bytes = encoder.encode(s);
  const stop = end ?? bytes.length;
  if (!isBoundary(bytes, start)) {
    throw new Utf8Error(`byte offset ${start} splits a UTF-8 sequence`);
  }
  if (!isBoundary(bytes, stop)) {
    throw new Utf8Error(`byte offset ${stop} splits a UTF-8 sequence`);
  }
  return utf8Decode(bytes.subarray(start, stop));
}

/**
 * Back a byte offset up to the nearest sequence start at or before it.
 *
 * Used by the WYSIWYG diff bridge, which trims a common prefix and suffix in
 * byte space and must not stop halfway through a character.
 */
export function floorBoundary(bytes: Uint8Array, at: number): number {
  let i = Math.min(Math.max(at, 0), bytes.length);
  while (i > 0 && !isBoundary(bytes, i)) i--;
  return i;
}
