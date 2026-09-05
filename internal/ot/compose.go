package ot

import "fmt"

// Compose returns a single operation equivalent to applying a and then b.
//
//	apply(apply(doc, a), b) == apply(doc, Compose(a, b))
//
// The server uses it to compact a room's history into a snapshot; the client
// uses it to merge pending local edits into one outgoing operation.
func Compose(a, b *OpSeq) (*OpSeq, error) {
	if a.targetLen != b.baseLen {
		return nil, fmt.Errorf("%w: cannot compose, first produces %d bytes and second expects %d",
			ErrLengthMismatch, a.targetLen, b.baseLen)
	}

	out := New()
	ia, ib := newIter(a.ops), newIter(b.ops)

	for ia.ok || ib.ok {
		// A delete in a happened before b existed, so it survives untouched.
		if ia.ok && ia.cur.Kind == KindDelete {
			out.Delete(ia.cur.N)
			ia.next()
			continue
		}
		// An insert in b lands in the composed document unchanged.
		if ib.ok && ib.cur.Kind == KindInsert {
			out.Insert(ib.cur.S)
			ib.next()
			continue
		}
		if !ia.ok || !ib.ok {
			return nil, fmt.Errorf("%w: ran out of components while composing", ErrIncompatible)
		}

		switch {
		case ia.cur.Kind == KindRetain && ib.cur.Kind == KindRetain:
			n := min(ia.cur.N, ib.cur.N)
			out.Retain(n)
			ia.takeN(n)
			ib.takeN(n)

		case ia.cur.Kind == KindInsert && ib.cur.Kind == KindDelete:
			// b deletes text a had just inserted: it never existed, emit nothing.
			n := min(len(ia.cur.S), ib.cur.N)
			if _, err := ia.takeS(n); err != nil {
				return nil, err
			}
			ib.takeN(n)

		case ia.cur.Kind == KindInsert && ib.cur.Kind == KindRetain:
			n := min(len(ia.cur.S), ib.cur.N)
			head, err := ia.takeS(n)
			if err != nil {
				return nil, err
			}
			out.Insert(head)
			ib.takeN(n)

		case ia.cur.Kind == KindRetain && ib.cur.Kind == KindDelete:
			n := min(ia.cur.N, ib.cur.N)
			out.Delete(n)
			ia.takeN(n)
			ib.takeN(n)

		default:
			return nil, fmt.Errorf("%w: composing %s with %s", ErrIncompatible, ia.cur.Kind, ib.cur.Kind)
		}
	}

	return out, nil
}

// Compose is the method form, for readability at call sites that already hold
// the left-hand operation.
func (s *OpSeq) Compose(other *OpSeq) (*OpSeq, error) { return Compose(s, other) }
