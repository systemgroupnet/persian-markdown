package ot

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Apply runs the operation against doc and returns the resulting document.
//
// This is the definition of correctness for everything else in the package:
// Compose and Transform are only meaningful in terms of what Apply produces.
func (s *OpSeq) Apply(doc string) (string, error) {
	if len(doc) != s.baseLen {
		return "", fmt.Errorf("%w: operation expects %d bytes, document has %d", ErrLengthMismatch, s.baseLen, len(doc))
	}

	var b strings.Builder
	b.Grow(s.targetLen)

	i := 0
	for _, o := range s.ops {
		switch o.Kind {
		case KindRetain:
			if err := checkBoundary(doc, i+o.N); err != nil {
				return "", err
			}
			b.WriteString(doc[i : i+o.N])
			i += o.N
		case KindDelete:
			if err := checkBoundary(doc, i+o.N); err != nil {
				return "", err
			}
			i += o.N
		case KindInsert:
			b.WriteString(o.S)
		}
	}

	out := b.String()
	// The boundary checks above already rule out a split retain or delete, and
	// UnmarshalJSON rules out a malformed insert. This last check costs one
	// linear scan and closes the gap for operations built in-process, so that
	// invalid UTF-8 can never reach the broadcast path or the snapshot.
	if !utf8.ValidString(out) {
		return "", fmt.Errorf("%w: result of apply is not valid UTF-8", ErrBoundary)
	}
	return out, nil
}

// Invert returns the operation that undoes s, given the document s applied to.
//
// Nothing in the collaborative editor calls this yet — undo is delegated to the
// editor's own history (PLAN.md §5.8). It exists because a proper OT undo stack
// is the one extension we expect to want later, and because it gives the test
// suite a cheap independent check on Apply: apply(apply(d, op), invert) == d.
func (s *OpSeq) Invert(doc string) *OpSeq {
	inv := New()
	i := 0
	for _, o := range s.ops {
		switch o.Kind {
		case KindRetain:
			inv.Retain(o.N)
			i += o.N
		case KindInsert:
			inv.Delete(len(o.S))
		case KindDelete:
			if i+o.N <= len(doc) {
				inv.Insert(doc[i : i+o.N])
			}
			i += o.N
		}
	}
	return inv
}
