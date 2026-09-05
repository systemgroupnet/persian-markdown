package ot

import (
	"errors"
	"math/rand"
	"strings"
	"testing"
	"unicode/utf8"
)

// corpus is the set of strings every structural test runs against. It exists to
// make the byte-vs-character distinction impossible to get away with ignoring:
// each entry breaks a different naive assumption.
var corpus = []string{
	"",
	"hello world",             // 1 byte per char, the only easy case
	"سلام دنیا",               // Persian: 2 bytes per char
	"می‌روم",                  // contains U+200C ZWNJ (3 bytes) *inside* a word
	"نیم‌فاصله و فاصله",       // ZWNJ next to an ordinary space
	"מה שלומך",                // Hebrew
	"a😀b",                     // 4-byte sequence
	"नमस्ते",                  // combining marks
	"مخلوط mixed متن",         // bidirectional
	"# عنوان\n\n- یک\n- دو\n", // markdown structure in Persian
}

const zwnj = "‌"

func TestInsertNormalisesAheadOfDelete(t *testing.T) {
	// insert and delete commute, so both orders describe the same edit. We
	// always encode insert first, otherwise two peers could produce different
	// bytes for the same operation and the shared golden vectors would be
	// meaningless.
	a := New()
	a.Delete(3)
	a.Insert("x")

	b := New()
	b.Insert("x")
	b.Delete(3)

	if a.String() != b.String() {
		t.Fatalf("equivalent operations encoded differently: %s vs %s", a, b)
	}
	if got, want := a.String(), `["x",-3]`; got != want {
		t.Fatalf("encoding = %s, want %s", got, want)
	}
}

func TestApply(t *testing.T) {
	tests := []struct {
		name  string
		doc   string
		build func(*OpSeq)
		want  string
	}{
		{"noop", "سلام", func(o *OpSeq) { o.Retain(8) }, "سلام"},
		{"append", "سلام", func(o *OpSeq) { o.Retain(8); o.Insert(" دنیا") }, "سلام دنیا"},
		{"prepend", "دنیا", func(o *OpSeq) { o.Insert("سلام "); o.Retain(8) }, "سلام دنیا"},
		{"delete all", "سلام", func(o *OpSeq) { o.Delete(8) }, ""},
		{"replace middle", "abcdef", func(o *OpSeq) { o.Retain(2); o.Delete(2); o.Insert("XY"); o.Retain(2) }, "abXYef"},
		{"insert zwnj", "میروم", func(o *OpSeq) { o.Retain(4); o.Insert(zwnj); o.Retain(6) }, "می‌روم"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			op := New()
			tc.build(op)
			got, err := op.Apply(tc.doc)
			if err != nil {
				t.Fatalf("Apply(%q) error: %v", tc.doc, err)
			}
			if got != tc.want {
				t.Fatalf("Apply(%q) = %q, want %q", tc.doc, got, tc.want)
			}
		})
	}
}

func TestApplyRejectsWrongBaseLength(t *testing.T) {
	op := New()
	op.Retain(5)
	if _, err := op.Apply("سلام"); !errors.Is(err, ErrLengthMismatch) {
		t.Fatalf("error = %v, want ErrLengthMismatch", err)
	}
}

func TestApplyRejectsSplitSequence(t *testing.T) {
	// "سلام" is four 2-byte characters. Retaining 1 byte lands in the middle of
	// the first one. A buggy or hostile client can send exactly this, and the
	// result would be mojibake broadcast to everyone in the room.
	const doc = "سلام"
	op := New()
	op.Retain(1)
	op.Delete(len(doc) - 1)

	if _, err := op.Apply(doc); !errors.Is(err, ErrBoundary) {
		t.Fatalf("error = %v, want ErrBoundary", err)
	}
}

func TestApplyRejectsSplitZWNJ(t *testing.T) {
	// The ZWNJ in "می‌روم" is 3 bytes at offset 4. Splitting it is the single
	// most likely way for a byte-offset bug to corrupt ordinary Persian text.
	const doc = "می‌روم"
	if doc[4:7] != zwnj {
		t.Fatalf("test premise wrong: bytes 4:7 are %q", doc[4:7])
	}
	for _, off := range []int{5, 6} {
		op := New()
		op.Retain(off)
		op.Delete(len(doc) - off)
		if _, err := op.Apply(doc); !errors.Is(err, ErrBoundary) {
			t.Fatalf("retain %d: error = %v, want ErrBoundary", off, err)
		}
	}
}

// TestRuneBoundaryRoundTrip deletes each character of each corpus entry in turn
// and inverts the result, which walks every legal boundary in the corpus.
func TestRuneBoundaryRoundTrip(t *testing.T) {
	for _, doc := range corpus {
		for i := 0; i < len(doc); {
			_, size := utf8.DecodeRuneInString(doc[i:])

			op := New()
			op.Retain(i)
			op.Delete(size)
			op.Retain(len(doc) - i - size)

			got, err := op.Apply(doc)
			if err != nil {
				t.Fatalf("doc %q offset %d: Apply: %v", doc, i, err)
			}
			if want := doc[:i] + doc[i+size:]; got != want {
				t.Fatalf("doc %q offset %d: got %q, want %q", doc, i, got, want)
			}
			if !utf8.ValidString(got) {
				t.Fatalf("doc %q offset %d: produced invalid UTF-8 %q", doc, i, got)
			}

			back, err := op.Invert(doc).Apply(got)
			if err != nil {
				t.Fatalf("doc %q offset %d: invert Apply: %v", doc, i, err)
			}
			if back != doc {
				t.Fatalf("doc %q offset %d: invert gave %q", doc, i, back)
			}

			i += size
		}
	}
}

func TestTransformIndex(t *testing.T) {
	insert := New() // retain 2, insert 2 bytes, retain 2
	insert.Retain(2)
	insert.Insert("xy")
	insert.Retain(2)

	del := New() // retain 2, delete 3, retain 2
	del.Retain(2)
	del.Delete(3)
	del.Retain(2)

	tests := []struct {
		name string
		op   *OpSeq
		pos  int
		want int
	}{
		{"insert, before", insert, 1, 1},
		{"insert, at point", insert, 2, 4},
		{"insert, after", insert, 3, 5},
		{"delete, before", del, 1, 1},
		{"delete, inside collapses to start", del, 4, 2},
		{"delete, after shifts back", del, 6, 3},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.op.TransformIndex(tc.pos); got != tc.want {
				t.Fatalf("TransformIndex(%d) = %d, want %d", tc.pos, got, tc.want)
			}
		})
	}
}

func TestJSONRoundTrip(t *testing.T) {
	op := New()
	op.Retain(4)
	op.Insert("سلام" + zwnj)
	op.Delete(6)
	op.Retain(2)

	encoded, err := op.MarshalJSON()
	if err != nil {
		t.Fatalf("MarshalJSON: %v", err)
	}

	var decoded OpSeq
	if err := decoded.UnmarshalJSON(encoded); err != nil {
		t.Fatalf("UnmarshalJSON: %v", err)
	}
	if decoded.String() != op.String() {
		t.Fatalf("round trip changed operation: %s -> %s", op, decoded.String())
	}
	if decoded.BaseLen() != op.BaseLen() || decoded.TargetLen() != op.TargetLen() {
		t.Fatalf("round trip changed lengths: %d/%d -> %d/%d",
			op.BaseLen(), op.TargetLen(), decoded.BaseLen(), decoded.TargetLen())
	}
}

func TestUnmarshalNormalisesLoneSurrogates(t *testing.T) {
	// encoding/json rewrites unpaired surrogates to U+FFFD rather than failing,
	// so an insert can never reach us as invalid UTF-8 through this path. What
	// matters instead is that the length accounting follows the *decoded* bytes:
	// U+FFFD is 3 bytes, and if TargetLen disagreed with the string we store,
	// every subsequent Compose and Transform in that room would be off by two.
	var op OpSeq
	if err := op.UnmarshalJSON([]byte(`["\udc00"]`)); err != nil {
		t.Fatalf("UnmarshalJSON: %v", err)
	}

	ops := op.Ops()
	if len(ops) != 1 || ops[0].Kind != KindInsert {
		t.Fatalf("expected a single insert, got %s", op.String())
	}
	if !utf8.ValidString(ops[0].S) {
		t.Fatalf("stored insert is not valid UTF-8: %q", ops[0].S)
	}
	if got, want := op.TargetLen(), len(ops[0].S); got != want {
		t.Fatalf("TargetLen = %d but insert is %d bytes", got, want)
	}
	if op.BaseLen() != 0 {
		t.Fatalf("BaseLen = %d, want 0", op.BaseLen())
	}
}

func TestUnmarshalRejectsMalformedComponents(t *testing.T) {
	for _, in := range []string{
		`[0]`,        // zero-length component carries no meaning
		`[{}]`,       // not a number or a string
		`5`,          // not an array
		`[1, true]`,  // bool component
		`[1, [2]]`,   // nested array
		`["a", 0.5]`, // fractional byte count
	} {
		var op OpSeq
		if err := op.UnmarshalJSON([]byte(in)); err == nil {
			t.Errorf("UnmarshalJSON(%s) = nil error, want a rejection", in)
		}
	}
}

// --- randomised property tests ------------------------------------------------

// alphabet deliberately mixes byte widths so that generated operations exercise
// boundaries that a pure-ASCII generator would never reach.
var alphabet = []string{
	"س", "ل", "ا", "م", "ی", // Persian, 2 bytes
	zwnj,     // 3 bytes, inside words
	"א", "ב", // Hebrew, 2 bytes
	"न", "म", // Devanagari, 3 bytes
	"😀",           // 4 bytes
	"a", "Z", "7", // 1 byte
	" ", "\n", "#", "*", "`", // markdown structure
}

func randomText(rng *rand.Rand) string {
	var b strings.Builder
	for n := 1 + rng.Intn(6); n > 0; n-- {
		b.WriteString(alphabet[rng.Intn(len(alphabet))])
	}
	return b.String()
}

func randomDoc(rng *rand.Rand) string {
	var b strings.Builder
	for n := rng.Intn(24); n > 0; n-- {
		b.WriteString(alphabet[rng.Intn(len(alphabet))])
	}
	return b.String()
}

// randomOp builds a valid operation over doc, always splitting at character
// boundaries — the same discipline a correct client must follow.
func randomOp(rng *rand.Rand, doc string) *OpSeq {
	rs := []rune(doc)
	op := New()
	for i := 0; i < len(rs); {
		if rng.Intn(3) == 0 {
			op.Insert(randomText(rng))
		}
		n := 1 + rng.Intn(len(rs)-i)
		width := len(string(rs[i : i+n]))
		if rng.Intn(2) == 0 {
			op.Retain(width)
		} else {
			op.Delete(width)
		}
		i += n
	}
	if rng.Intn(3) == 0 {
		op.Insert(randomText(rng))
	}
	return op
}

func iterations() int {
	if testing.Short() {
		return 500
	}
	return 20000
}

// TestTransformConvergence is the property the entire product rests on: two
// peers editing the same document concurrently, in either arrival order, must
// end up with identical bytes.
func TestTransformConvergence(t *testing.T) {
	rng := rand.New(rand.NewSource(20260905))

	for i := 0; i < iterations(); i++ {
		doc := randomDoc(rng)
		a, b := randomOp(rng, doc), randomOp(rng, doc)

		aPrime, bPrime, err := Transform(a, b)
		if err != nil {
			t.Fatalf("Transform: %v\n doc=%q\n a=%s\n b=%s", err, doc, a, b)
		}

		ab, err := Compose(a, bPrime)
		if err != nil {
			t.Fatalf("Compose(a, b'): %v\n doc=%q\n a=%s\n b'=%s", err, doc, a, bPrime)
		}
		ba, err := Compose(b, aPrime)
		if err != nil {
			t.Fatalf("Compose(b, a'): %v\n doc=%q\n b=%s\n a'=%s", err, doc, b, aPrime)
		}

		x, err := ab.Apply(doc)
		if err != nil {
			t.Fatalf("apply compose(a, b'): %v\n doc=%q", err, doc)
		}
		y, err := ba.Apply(doc)
		if err != nil {
			t.Fatalf("apply compose(b, a'): %v\n doc=%q", err, doc)
		}
		if x != y {
			t.Fatalf("divergence\n doc=%q\n a=%s\n b=%s\n a'=%s\n b'=%s\n got  %q\n and  %q",
				doc, a, b, aPrime, bPrime, x, y)
		}

		// The transformed operation must also work when applied on top of the
		// other peer's document, which is how the client actually uses it.
		mid, err := a.Apply(doc)
		if err != nil {
			t.Fatalf("apply a: %v", err)
		}
		seq, err := bPrime.Apply(mid)
		if err != nil {
			t.Fatalf("apply b' to a's result: %v\n doc=%q\n b'=%s", err, doc, bPrime)
		}
		if seq != x {
			t.Fatalf("compose disagrees with sequential apply\n doc=%q\n got %q want %q", doc, seq, x)
		}
	}
}

func TestComposeMatchesSequentialApply(t *testing.T) {
	rng := rand.New(rand.NewSource(3141592))

	for i := 0; i < iterations(); i++ {
		doc := randomDoc(rng)
		a := randomOp(rng, doc)

		mid, err := a.Apply(doc)
		if err != nil {
			t.Fatalf("apply a: %v\n doc=%q\n a=%s", err, doc, a)
		}
		b := randomOp(rng, mid)

		want, err := b.Apply(mid)
		if err != nil {
			t.Fatalf("apply b: %v", err)
		}

		ab, err := Compose(a, b)
		if err != nil {
			t.Fatalf("Compose: %v\n doc=%q\n a=%s\n b=%s", err, doc, a, b)
		}
		got, err := ab.Apply(doc)
		if err != nil {
			t.Fatalf("apply composed: %v\n doc=%q", err, doc)
		}
		if got != want {
			t.Fatalf("compose != sequential\n doc=%q\n a=%s\n b=%s\n got %q want %q", doc, a, b, got, want)
		}
	}
}

func TestInvertRestoresDocument(t *testing.T) {
	rng := rand.New(rand.NewSource(2718281))

	for i := 0; i < iterations(); i++ {
		doc := randomDoc(rng)
		op := randomOp(rng, doc)

		after, err := op.Apply(doc)
		if err != nil {
			t.Fatalf("apply: %v", err)
		}
		back, err := op.Invert(doc).Apply(after)
		if err != nil {
			t.Fatalf("apply inverse: %v\n doc=%q\n op=%s", err, doc, op)
		}
		if back != doc {
			t.Fatalf("invert did not restore\n doc=%q\n op=%s\n got %q", doc, op, back)
		}
	}
}

// TestEveryResultIsValidUTF8 guards the property that actually protects users:
// no sequence of legal operations can ever produce a broken document.
func TestEveryResultIsValidUTF8(t *testing.T) {
	rng := rand.New(rand.NewSource(1618033))

	for i := 0; i < iterations(); i++ {
		doc := randomDoc(rng)
		a, b := randomOp(rng, doc), randomOp(rng, doc)
		aPrime, bPrime, err := Transform(a, b)
		if err != nil {
			t.Fatalf("Transform: %v", err)
		}
		// Walk both arrival orders end to end, checking every intermediate
		// document as well as the final one — a transformed operation landing
		// mid-sequence is exactly where a boundary bug would show up.
		for _, order := range [][2]*OpSeq{{a, bPrime}, {b, aPrime}} {
			cur := doc
			for _, op := range order {
				next, err := op.Apply(cur)
				if err != nil {
					t.Fatalf("apply %s to %q: %v", op, cur, err)
				}
				if !utf8.ValidString(next) {
					t.Fatalf("invalid UTF-8 %q produced from %q by %s", next, cur, op)
				}
				cur = next
			}
		}
	}
}

func FuzzTransform(f *testing.F) {
	for _, doc := range corpus {
		f.Add(doc, int64(1))
	}

	f.Fuzz(func(t *testing.T, doc string, seed int64) {
		if !utf8.ValidString(doc) || len(doc) > 512 {
			t.Skip()
		}
		rng := rand.New(rand.NewSource(seed))
		a, b := randomOp(rng, doc), randomOp(rng, doc)

		aPrime, bPrime, err := Transform(a, b)
		if err != nil {
			t.Fatalf("Transform: %v", err)
		}
		ab, err := Compose(a, bPrime)
		if err != nil {
			t.Fatalf("Compose(a, b'): %v", err)
		}
		ba, err := Compose(b, aPrime)
		if err != nil {
			t.Fatalf("Compose(b, a'): %v", err)
		}
		x, err := ab.Apply(doc)
		if err != nil {
			t.Fatalf("apply: %v", err)
		}
		y, err := ba.Apply(doc)
		if err != nil {
			t.Fatalf("apply: %v", err)
		}
		if x != y {
			t.Fatalf("divergence: %q vs %q (doc=%q a=%s b=%s)", x, y, doc, a, b)
		}
	})
}
