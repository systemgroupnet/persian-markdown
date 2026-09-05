package names

import (
	"math/rand"
	"testing"
	"unicode/utf8"
)

func TestAnimalsAreWellFormed(t *testing.T) {
	if len(Animals) < 100 {
		t.Fatalf("pool has %d names, want at least 100 to keep collisions rare", len(Animals))
	}
	seen := make(map[string]struct{}, len(Animals))
	for _, n := range Animals {
		if _, dup := seen[n]; dup {
			t.Errorf("duplicate name %q", n)
		}
		seen[n] = struct{}{}
		if !utf8.ValidString(n) {
			t.Errorf("name %q is not valid UTF-8", n)
		}
		if !Valid(n) {
			t.Errorf("name %q from the pool fails Valid", n)
		}
	}
}

func TestUniqueAvoidsCollisions(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	taken := make(map[string]struct{})

	// Exhaust the pool and keep going, which forces the numbered fallback.
	for i := 0; i < len(Animals)+25; i++ {
		n := Unique(r, taken)
		if _, dup := taken[n]; dup {
			t.Fatalf("Unique returned %q which was already taken (iteration %d)", n, i)
		}
		if !Valid(n) {
			t.Fatalf("Unique returned invalid name %q", n)
		}
		taken[n] = struct{}{}
	}
}

func TestHueIsStableAndInRange(t *testing.T) {
	for _, n := range Animals {
		h := Hue(n)
		if h < 0 || h >= 360 {
			t.Fatalf("Hue(%q) = %d, outside [0,360)", n, h)
		}
		if again := Hue(n); again != h {
			t.Fatalf("Hue(%q) is not stable: %d then %d", n, h, again)
		}
	}
}

func TestFaDigits(t *testing.T) {
	tests := map[int]string{0: "۰", 2: "۲", 7: "۷", 10: "۱۰", 42: "۴۲", 1403: "۱۴۰۳"}
	for in, want := range tests {
		if got := FaDigits(in); got != want {
			t.Errorf("FaDigits(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestValidRejectsSpoofingInput(t *testing.T) {
	bad := []string{
		"",
		"   ",
		"a\x00b",
		"line\nbreak",
		"‮گرگ",                   // RLO: visually reorders neighbouring text
		"⁦spoof⁩",                // isolate
		string(make([]byte, 65)), // over the length bound
	}
	for _, n := range bad {
		if Valid(n) {
			t.Errorf("Valid(%q) = true, want false", n)
		}
	}

	good := []string{"هدهد", "یوزپلنگ ایرانی", "سمندر لرستانی ۲", "Ali", "زاغ بور"}
	for _, n := range good {
		if !Valid(n) {
			t.Errorf("Valid(%q) = false, want true", n)
		}
	}
}
