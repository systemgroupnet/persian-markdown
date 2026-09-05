// Package names supplies the anonymous identities used in shared rooms.
//
// There are no accounts in this product, so a name is the only thing that makes
// one caret distinguishable from another. The list is deliberately drawn from
// animals found in Iran — including several endemic and critically endangered
// species — rather than from a generic word list, because the name is the one
// piece of personality a login-less tool gets to have.
package names

import (
	"hash/fnv"
	"math/rand"
	"strings"
)

// Animals is the pool of display names.
var Animals = []string{
	// گربه‌سانان
	"یوزپلنگ ایرانی", "پلنگ ایرانی", "کاراکال", "سیاه‌گوش", "گربه پالاس",
	"گربه شنی", "گربه وحشی", "ببر مازندران",
	// سگ‌سانان و گوشت‌خواران
	"گرگ", "شغال", "روباه قرمز", "روباه شنی", "روباه ترکمنی", "کفتار راه‌راه",
	"خرس قهوه‌ای", "خرس سیاه بلوچی", "سمور جنگلی", "سمور سنگی", "راسو",
	"گورکن", "شنگ", "زرده‌بر",
	// سم‌داران
	"گورخر ایرانی", "آهو", "جبیر", "گوزن زرد ایرانی", "مرال", "شوکا",
	"کل", "بز وحشی", "پازن", "قوچ", "میش", "گراز",
	// پستانداران کوچک
	"تشی", "خارپشت", "خرگوش", "موش خرمایی", "جربیل", "سنجاب ایرانی",
	"خفاش", "مورچه‌خوار",
	// آبزیان
	"فک خزری", "دلفین", "نهنگ", "تاس‌ماهی", "فیل‌ماهی", "ماهی آزاد",
	"سفیدماهی", "اردک‌ماهی", "میگو", "خرچنگ",
	// پرندگان شکاری
	"عقاب طلایی", "شاهین", "بحری", "دلیجه", "قرقی", "سنقر", "کرکس", "هما",
	"جغد", "بوف", "شب‌آویز",
	// پرندگان آبزی و کنارآبزی
	"درنا", "لک‌لک", "حواصیل", "اگرت", "فلامینگو", "پلیکان", "قو", "غاز",
	"اردک سرسبز", "مرغابی", "چنگر",
	// پرندگان خشکی‌زی
	"هدهد", "زاغ بور", "کبک", "تیهو", "دراج", "هوبره", "قرقاول", "باقرقره",
	"سبزقبا", "زنبورخوار", "دارکوب", "چکاوک", "سهره", "بلبل", "چلچله",
	"پرستو", "سار", "کلاغ", "فاخته", "کبوتر", "طوطی",
	// خزندگان و دوزیستان
	"لاک‌پشت", "لاک‌پشت پوزه‌عقابی", "سوسمار", "بزمجه", "آگاما", "گکو",
	"مار", "افعی", "کورمار", "سمندر لرستانی", "قورباغه", "وزغ",
	// بندپایان
	"عقرب", "رتیل", "زنبور عسل", "پروانه", "سنجاقک", "ملخ", "کفشدوزک",
	"شب‌پره", "مورچه", "عنکبوت",
}

// persianDigits maps 0-9 to their Persian forms.
var persianDigits = [...]rune{'۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'}

// Pick returns a random name from the pool.
func Pick(r *rand.Rand) string {
	return Animals[r.Intn(len(Animals))]
}

// Unique returns a name not already present in taken.
//
// With ~110 names a collision needs only a handful of people in one room
// (birthday paradox: better than even odds at 13), so this is a routine path,
// not an edge case. Once every name is in use we fall back to numbering, which
// keeps the room usable rather than looping forever.
func Unique(r *rand.Rand, taken map[string]struct{}) string {
	const attempts = 24
	for i := 0; i < attempts; i++ {
		if n := Pick(r); !contains(taken, n) {
			return n
		}
	}
	base := Pick(r)
	for i := 2; ; i++ {
		candidate := base + " " + FaDigits(i)
		if !contains(taken, candidate) {
			return candidate
		}
	}
}

func contains(m map[string]struct{}, k string) bool {
	_, ok := m[k]
	return ok
}

// Hue maps a name to a stable hue in [0, 360).
//
// Stability is the point: the same animal must be the same color for everyone
// in the room, and must survive a reconnect, without the server having to
// allocate or broadcast colors. This is the only color in the entire product —
// the UI itself is monochrome — so it carries real information rather than
// decoration.
func Hue(name string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	return int(h.Sum32() % 360)
}

// FaDigits renders a non-negative integer with Persian digits.
//
// Presentation only. Document content is never transformed this way.
func FaDigits(n int) string {
	if n == 0 {
		return string(persianDigits[0])
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []rune
	for n > 0 {
		b = append([]rune{persianDigits[n%10]}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}

// Valid reports whether a client-supplied name is acceptable.
//
// Clients send their own name so that a reconnect keeps the same identity, which
// means it is untrusted input rendered next to other people's carets. We bound
// the length and refuse control characters and bidi overrides — the latter can
// visually reorder surrounding text in the presence list, which in an RTL app is
// a spoofing vector rather than a cosmetic problem.
func Valid(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, r := range name {
		switch {
		case r < 0x20, r == 0x7f:
			return false
		case r >= 0x202a && r <= 0x202e: // LRE, RLE, PDF, LRO, RLO
			return false
		case r >= 0x2066 && r <= 0x2069: // LRI, RLI, FSI, PDI
			return false
		}
	}
	return strings.TrimSpace(name) != ""
}
