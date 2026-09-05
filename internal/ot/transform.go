package ot

import "fmt"

// Transform resolves two operations made concurrently against the same
// document, returning aPrime and bPrime such that:
//
//	Compose(a, bPrime) ≡ Compose(b, aPrime)
//
// which is the TP1 property, and the whole reason this package exists: it lets
// two peers who edited the same text at the same time end up with byte-identical
// documents regardless of the order the edits arrived in.
//
// Note the asymmetry in the insert/insert case below. When both sides insert at
// the same position there is no correct answer, only a consistent one — so a's
// insert is always placed first. Every peer must apply that same rule; the
// TypeScript engine in web/src/ot does, and testdata/ot-vectors.json is what
// keeps the two honest.
func Transform(a, b *OpSeq) (*OpSeq, *OpSeq, error) {
	if a.baseLen != b.baseLen {
		return nil, nil, fmt.Errorf("%w: cannot transform, base lengths %d and %d differ",
			ErrLengthMismatch, a.baseLen, b.baseLen)
	}

	aPrime, bPrime := New(), New()
	ia, ib := newIter(a.ops), newIter(b.ops)

	for ia.ok || ib.ok {
		// Inserts from a take precedence, deterministically.
		if ia.ok && ia.cur.Kind == KindInsert {
			aPrime.Insert(ia.cur.S)
			bPrime.Retain(len(ia.cur.S))
			ia.next()
			continue
		}
		if ib.ok && ib.cur.Kind == KindInsert {
			aPrime.Retain(len(ib.cur.S))
			bPrime.Insert(ib.cur.S)
			ib.next()
			continue
		}
		if !ia.ok || !ib.ok {
			return nil, nil, fmt.Errorf("%w: ran out of components while transforming", ErrIncompatible)
		}

		switch {
		case ia.cur.Kind == KindRetain && ib.cur.Kind == KindRetain:
			n := min(ia.cur.N, ib.cur.N)
			aPrime.Retain(n)
			bPrime.Retain(n)
			ia.takeN(n)
			ib.takeN(n)

		case ia.cur.Kind == KindDelete && ib.cur.Kind == KindDelete:
			// Both peers deleted the same bytes. The text is already gone, so
			// neither transformed operation should delete it a second time.
			n := min(ia.cur.N, ib.cur.N)
			ia.takeN(n)
			ib.takeN(n)

		case ia.cur.Kind == KindDelete && ib.cur.Kind == KindRetain:
			n := min(ia.cur.N, ib.cur.N)
			aPrime.Delete(n)
			ia.takeN(n)
			ib.takeN(n)

		case ia.cur.Kind == KindRetain && ib.cur.Kind == KindDelete:
			n := min(ia.cur.N, ib.cur.N)
			bPrime.Delete(n)
			ia.takeN(n)
			ib.takeN(n)

		default:
			return nil, nil, fmt.Errorf("%w: transforming %s against %s", ErrIncompatible, ia.cur.Kind, ib.cur.Kind)
		}
	}

	return aPrime, bPrime, nil
}

// Transform is the method form. The receiver is the "a" side, so the first
// result is the receiver rebased onto other.
func (s *OpSeq) Transform(other *OpSeq) (*OpSeq, *OpSeq, error) { return Transform(s, other) }
