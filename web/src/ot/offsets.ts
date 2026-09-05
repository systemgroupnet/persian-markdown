/**
 * Conversion between the browser's UTF-16 offsets and the protocol's UTF-8
 * byte offsets.
 *
 * This is the single riskiest piece of client code in the product (PLAN.md R2).
 * CodeMirror offsets, Slate points and `selectionStart` are all UTF-16 code
 * units; operations are UTF-8 bytes; and for Persian the two never coincide —
 * every letter is 2 bytes and 1 unit, and ZWNJ is 3 bytes and 1 unit. There is
 * no ASCII happy path that would let a conversion bug hide during development.
 *
 * The naive implementation — the one Rustpad ships — recomputes the length of
 * the whole document prefix on every keystroke:
 *
 *     const initialLength = unicodeLength(content.slice(0, rangeOffset));
 *
 * That is O(document) per edit, plus a full string copy. Here we keep the byte
 * offset of every line start, so a conversion is a binary search followed by a
 * scan of one line: O(log lines + line length). Edits update the index in
 * place rather than rebuilding it.
 *
 * Every method is total with respect to out-of-range input — offsets are
 * clamped to the document — except byte offsets that fall inside a character,
 * which throw, because silently rounding those is how documents get corrupted.
 */

import { Utf8Error, charByteWidth, utf8Length, utf8LengthBetween } from "./utf8";

export class OffsetIndex {
  private text: string;
  /** UTF-16 offset of the start of each line. Always begins with 0. */
  private u16: number[] = [0];
  /** UTF-8 byte offset of the start of each line. Always begins with 0. */
  private u8: number[] = [0];
  private totalBytes = 0;

  constructor(text = "") {
    this.text = text;
    this.rebuild();
  }

  get document(): string {
    return this.text;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  get lineCount(): number {
    return this.u16.length;
  }

  /** Replace the whole document. O(n) — use `replace` for edits. */
  reset(text: string): void {
    this.text = text;
    this.rebuild();
  }

  /** UTF-16 offset → UTF-8 byte offset. */
  toBytes(pos: number): number {
    const p = clamp(pos, 0, this.text.length);
    const line = this.lineAtUnit(p);
    return this.u8[line]! + utf8LengthBetween(this.text, this.u16[line]!, p);
  }

  /**
   * UTF-8 byte offset → UTF-16 offset.
   *
   * Throws if the byte offset lands inside a character: that means the peer
   * that produced it has a broken notion of the document, and continuing would
   * turn a detectable protocol error into silent text corruption.
   */
  toUnits(byteOffset: number): number {
    const target = clamp(byteOffset, 0, this.totalBytes);
    const line = this.lineAtByte(target);

    let bytes = this.u8[line]!;
    let i = this.u16[line]!;
    while (bytes < target && i < this.text.length) {
      const { bytes: w, units } = charByteWidth(this.text, i);
      if (bytes + w > target) {
        throw new Utf8Error(
          `byte offset ${byteOffset} falls inside a character starting at unit ${i}`,
        );
      }
      bytes += w;
      i += units;
    }
    if (bytes !== target) {
      throw new Utf8Error(`byte offset ${byteOffset} is not reachable in this document`);
    }
    return i;
  }

  toByteRange(from: number, to: number): [number, number] {
    return [this.toBytes(from), this.toBytes(to)];
  }

  /**
   * Apply an edit expressed in UTF-16 offsets, keeping the index current.
   *
   * Only the lines the edit touches are recomputed; every later line start is
   * shifted by a constant. That makes an edit O(edited region + lines after it)
   * rather than O(document).
   */
  replace(from: number, to: number, inserted: string): void {
    const start = clamp(Math.min(from, to), 0, this.text.length);
    const end = clamp(Math.max(from, to), 0, this.text.length);

    // An edit boundary between the halves of a surrogate pair would leave a
    // lone surrogate behind, and the byte accounting stops being additive:
    // removing one half of a 4-byte character leaves 3 bytes, not 0. Editors
    // never produce such a change, so this is an upstream bug worth surfacing
    // rather than silently absorbing.
    assertAligned(this.text, start);
    assertAligned(this.text, end);

    const firstLine = this.lineAtUnit(start);
    const lastLine = this.lineAtUnit(end);
    const hasTail = lastLine + 1 < this.u16.length;

    const removedBytes = utf8LengthBetween(this.text, start, end);
    const insertedBytes = utf8Length(inserted);
    const deltaUnits = inserted.length - (end - start);
    const deltaBytes = insertedBytes - removedBytes;

    // The region we recompute runs from the start of the first touched line to
    // the end of the last touched line, in the *new* text.
    const regionStartUnit = this.u16[firstLine]!;
    const regionStartByte = this.u8[firstLine]!;
    const oldRegionEndUnit =
      lastLine + 1 < this.u16.length ? this.u16[lastLine + 1]! : this.text.length;
    const newRegionEndUnit = oldRegionEndUnit + deltaUnits;

    this.text = this.text.slice(0, start) + inserted + this.text.slice(end);

    // Recompute the line starts inside the region.
    const newU16: number[] = [];
    const newU8: number[] = [];
    let bytes = regionStartByte;
    for (let i = regionStartUnit; i < newRegionEndUnit; i++) {
      const c = this.text.charCodeAt(i);
      const { bytes: w, units } = charByteWidth(this.text, i);
      bytes += w;
      if (units === 2) i++;
      if (c === 10 /* \n */) {
        const lineStart = i + 1;
        // A line starting exactly at the region end is the first line of the
        // tail, and the shifted tail below already supplies it. Emitting it
        // here too would duplicate the entry and desynchronise every
        // subsequent lookup.
        if (!hasTail || lineStart < newRegionEndUnit) {
          newU16.push(lineStart);
          newU8.push(bytes);
        }
      }
    }

    // Splice the region's line starts in, dropping the ones it replaced.
    const tailStart = lastLine + 1;
    const shiftedU16 = this.u16.slice(tailStart).map((v) => v + deltaUnits);
    const shiftedU8 = this.u8.slice(tailStart).map((v) => v + deltaBytes);

    this.u16 = this.u16.slice(0, firstLine + 1).concat(newU16, shiftedU16);
    this.u8 = this.u8.slice(0, firstLine + 1).concat(newU8, shiftedU8);
    this.totalBytes += deltaBytes;
  }

  private rebuild(): void {
    const t = this.text;
    const u16: number[] = [0];
    const u8: number[] = [0];
    let bytes = 0;

    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      const { bytes: w, units } = charByteWidth(t, i);
      bytes += w;
      if (units === 2) i++;
      if (c === 10) {
        u16.push(i + 1);
        u8.push(bytes);
      }
    }

    this.u16 = u16;
    this.u8 = u8;
    this.totalBytes = bytes;
  }

  /** Index of the line containing a UTF-16 offset. */
  private lineAtUnit(pos: number): number {
    return upperBound(this.u16, pos);
  }

  /** Index of the line containing a byte offset. */
  private lineAtByte(pos: number): number {
    return upperBound(this.u8, pos);
  }
}

/** Largest i such that starts[i] <= value. starts is sorted and starts with 0. */
function upperBound(starts: readonly number[], value: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Throw if pos sits between the two halves of a surrogate pair. */
function assertAligned(text: string, pos: number): void {
  if (pos <= 0 || pos >= text.length) return;
  const prev = text.charCodeAt(pos - 1);
  const cur = text.charCodeAt(pos);
  if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) {
    throw new Utf8Error(`offset ${pos} splits a surrogate pair`);
  }
}
