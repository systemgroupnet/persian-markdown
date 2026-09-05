package ot

// TransformIndex maps a byte position in the document before this operation to
// the equivalent position after it.
//
// The server uses it to keep every collaborator's caret and selection anchored
// while other people type around them — without it, an edit above your cursor
// drags the cursor along by the wrong amount and remote carets drift steadily
// out of place.
//
// Text deleted out from under a position collapses that position to the start
// of the deleted range, which is what an editor does when the line you were
// sitting on disappears.
func (s *OpSeq) TransformIndex(pos int) int {
	if pos < 0 {
		return 0
	}
	remaining, out := pos, pos
	for _, o := range s.ops {
		switch o.Kind {
		case KindRetain:
			remaining -= o.N
		case KindInsert:
			out += len(o.S)
		case KindDelete:
			out -= min(remaining, o.N)
			remaining -= o.N
		}
		if remaining < 0 {
			break
		}
	}
	if out < 0 {
		return 0
	}
	return out
}

// TransformRange maps a selection through the operation.
func (s *OpSeq) TransformRange(start, end int) (int, int) {
	a, b := s.TransformIndex(start), s.TransformIndex(end)
	if a > b {
		a, b = b, a
	}
	return a, b
}
