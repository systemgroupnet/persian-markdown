// Package ot implements operational transformation over text.
//
// # Units
//
// Every position and length in this package is counted in UTF-8 BYTES — not
// runes, not UTF-16 code units. Go strings are already UTF-8, so the engine
// slices them directly and there is no encoding shim anywhere in the Go tree.
// The conversion from the browser's UTF-16 offsets happens on the client, in
// web/src/ot/offsets.ts. See PLAN.md §3.2.
//
// The consequence to keep in mind while reading this code: a Persian character
// is 2 bytes and U+200C ZWNJ (نیم‌فاصله, which appears inside ordinary Persian
// words) is 3, so byte counts and character counts diverge constantly. An
// operation whose boundary lands in the middle of a multi-byte sequence is
// always a bug, and every entry point here refuses to produce one rather than
// letting the corruption propagate to other clients.
//
// The wire format matches ot.js so that this engine and the TypeScript one can
// share golden vectors: a JSON array where a positive number is a retain, a
// negative number is a delete, and a string is an insert.
package ot

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"
)

// Kind distinguishes the three component types of an operation.
type Kind uint8

const (
	KindRetain Kind = iota
	KindInsert
	KindDelete
)

func (k Kind) String() string {
	switch k {
	case KindRetain:
		return "retain"
	case KindInsert:
		return "insert"
	case KindDelete:
		return "delete"
	}
	return "invalid"
}

// Op is a single component of an operation. N is meaningful for retain and
// delete (a byte count), S for insert.
type Op struct {
	Kind Kind
	N    int
	S    string
}

// Len returns the number of bytes this component spans in its own encoding.
func (o Op) Len() int {
	if o.Kind == KindInsert {
		return len(o.S)
	}
	return o.N
}

var (
	// ErrLengthMismatch means an operation was applied to, composed with, or
	// transformed against something of the wrong length.
	ErrLengthMismatch = errors.New("ot: length mismatch")
	// ErrBoundary means an operation boundary fell inside a multi-byte UTF-8
	// sequence. Always a bug in whichever peer produced the operation.
	ErrBoundary = errors.New("ot: operation boundary splits a UTF-8 sequence")
	// ErrIncompatible means two operations could not be combined.
	ErrIncompatible = errors.New("ot: operations are not compatible")
	// ErrInvalidUTF8 means an insert carried bytes that are not valid UTF-8.
	ErrInvalidUTF8 = errors.New("ot: insert is not valid UTF-8")
)

// OpSeq is a sequence of components applied left to right against a document.
// The zero value is a valid empty operation over an empty document.
type OpSeq struct {
	ops       []Op
	baseLen   int
	targetLen int
}

// New returns an empty operation.
func New() *OpSeq { return &OpSeq{} }

// BaseLen is the length in bytes of the document this operation applies to.
func (s *OpSeq) BaseLen() int { return s.baseLen }

// TargetLen is the length in bytes of the document this operation produces.
func (s *OpSeq) TargetLen() int { return s.targetLen }

// Ops returns the components. The slice must not be modified.
func (s *OpSeq) Ops() []Op { return s.ops }

// IsNoop reports whether applying this operation leaves a document unchanged.
func (s *OpSeq) IsNoop() bool {
	return len(s.ops) == 0 || (len(s.ops) == 1 && s.ops[0].Kind == KindRetain)
}

// Retain advances over n bytes of the document unchanged. Non-positive n is
// ignored, which lets callers emit lengths without guarding every call site.
func (s *OpSeq) Retain(n int) {
	if n <= 0 {
		return
	}
	s.baseLen += n
	s.targetLen += n
	if k := len(s.ops) - 1; k >= 0 && s.ops[k].Kind == KindRetain {
		s.ops[k].N += n
		return
	}
	s.ops = append(s.ops, Op{Kind: KindRetain, N: n})
}

// Delete removes n bytes. The sign of n is ignored so that callers may pass the
// wire representation directly.
func (s *OpSeq) Delete(n int) {
	if n < 0 {
		n = -n
	}
	if n == 0 {
		return
	}
	s.baseLen += n
	if k := len(s.ops) - 1; k >= 0 && s.ops[k].Kind == KindDelete {
		s.ops[k].N += n
		return
	}
	s.ops = append(s.ops, Op{Kind: KindDelete, N: n})
}

// Insert adds text at the current position.
//
// Insert and delete commute, so "delete 3, insert x" and "insert x, delete 3"
// describe the same edit. We always normalise to insert-first, which means two
// equivalent operations encode identically — that is what makes the golden
// vectors shared with the TypeScript engine meaningful. ot.js does the same.
func (s *OpSeq) Insert(str string) {
	if str == "" {
		return
	}
	s.targetLen += len(str)
	n := len(s.ops)
	switch {
	case n > 0 && s.ops[n-1].Kind == KindInsert:
		s.ops[n-1].S += str
	case n > 0 && s.ops[n-1].Kind == KindDelete:
		if n > 1 && s.ops[n-2].Kind == KindInsert {
			s.ops[n-2].S += str
			return
		}
		// Shift the delete right and slot the insert in front of it.
		s.ops = append(s.ops, s.ops[n-1])
		s.ops[n-1] = Op{Kind: KindInsert, S: str}
	default:
		s.ops = append(s.ops, Op{Kind: KindInsert, S: str})
	}
}

// MarshalJSON encodes in the ot.js wire format.
func (s *OpSeq) MarshalJSON() ([]byte, error) {
	raw := make([]any, 0, len(s.ops))
	for _, o := range s.ops {
		switch o.Kind {
		case KindRetain:
			raw = append(raw, o.N)
		case KindDelete:
			raw = append(raw, -o.N)
		case KindInsert:
			raw = append(raw, o.S)
		}
	}
	return json.Marshal(raw)
}

// UnmarshalJSON decodes the ot.js wire format.
//
// This is the trust boundary: everything here arrives from a network peer, so
// inserts are validated as UTF-8 on the way in. Rejecting malformed bytes at
// the edge is much cheaper than discovering them once they are in a document
// that has already been broadcast.
func (s *OpSeq) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("ot: decode operation: %w", err)
	}
	*s = OpSeq{}
	for i, item := range raw {
		trimmed := bytes.TrimSpace(item)
		if len(trimmed) == 0 {
			return fmt.Errorf("ot: empty component at index %d", i)
		}
		if trimmed[0] == '"' {
			var str string
			if err := json.Unmarshal(trimmed, &str); err != nil {
				return fmt.Errorf("ot: decode insert at index %d: %w", i, err)
			}
			if !utf8.ValidString(str) {
				return fmt.Errorf("%w: at index %d", ErrInvalidUTF8, i)
			}
			s.Insert(str)
			continue
		}
		var n int
		if err := json.Unmarshal(trimmed, &n); err != nil {
			return fmt.Errorf("ot: decode component at index %d: %w", i, err)
		}
		switch {
		case n > 0:
			s.Retain(n)
		case n < 0:
			s.Delete(-n)
		default:
			return fmt.Errorf("ot: zero-length component at index %d", i)
		}
	}
	return nil
}

// String renders the wire format, for logs and test failures.
func (s *OpSeq) String() string {
	b, err := s.MarshalJSON()
	if err != nil {
		return fmt.Sprintf("<invalid operation: %v>", err)
	}
	return string(b)
}

// checkBoundary reports whether at is a valid split point in doc.
func checkBoundary(doc string, at int) error {
	if at < 0 || at > len(doc) {
		return fmt.Errorf("%w: offset %d outside document of %d bytes", ErrLengthMismatch, at, len(doc))
	}
	if at < len(doc) && !utf8.RuneStart(doc[at]) {
		return fmt.Errorf("%w: at byte %d", ErrBoundary, at)
	}
	return nil
}

// iter walks a component slice, allowing the head component to be consumed in
// pieces. Compose and Transform both advance two of these in lockstep.
type iter struct {
	ops []Op
	i   int
	cur Op
	ok  bool
}

func newIter(ops []Op) *iter {
	it := &iter{ops: ops}
	it.next()
	return it
}

func (t *iter) next() {
	if t.i < len(t.ops) {
		t.cur = t.ops[t.i]
		t.i++
		t.ok = true
		return
	}
	t.cur = Op{}
	t.ok = false
}

// takeN consumes n bytes from a retain or delete head.
func (t *iter) takeN(n int) {
	t.cur.N -= n
	if t.cur.N <= 0 {
		t.next()
	}
}

// takeS consumes n bytes from an insert head and returns them, refusing to
// split a multi-byte sequence.
func (t *iter) takeS(n int) (string, error) {
	if n < len(t.cur.S) && !utf8.RuneStart(t.cur.S[n]) {
		return "", fmt.Errorf("%w: splitting insert at byte %d", ErrBoundary, n)
	}
	head := t.cur.S[:n]
	t.cur.S = t.cur.S[n:]
	if t.cur.S == "" {
		t.next()
	}
	return head, nil
}
