package room

import "github.com/systemgroupnet/persian-markdown/internal/ot"

// The wire protocol. Messages are externally tagged — exactly one field of each
// envelope is populated — which keeps the JSON self-describing and matches the
// shape Rustpad uses, so its client is a useful reference while building ours.
//
// Everything here crosses a trust boundary. Nothing in this file may be assumed
// well-formed just because it parsed.

// UserInfo is a participant's display identity.
type UserInfo struct {
	Name string `json:"name"`
	Hue  int    `json:"hue"`
}

// CursorData is where a participant is looking. Offsets are UTF-8 byte
// positions in the document, the same unit as operations (PLAN.md §3.2).
type CursorData struct {
	Cursors    []int    `json:"cursors"`
	Selections [][2]int `json:"selections"`
}

// EditMsg carries an operation together with the revision it was composed
// against, so the server knows how far to rebase it.
type EditMsg struct {
	Revision  int       `json:"revision"`
	Operation *ot.OpSeq `json:"operation"`
}

// ClientMsg is anything a browser may send.
type ClientMsg struct {
	Edit       *EditMsg    `json:"Edit,omitempty"`
	ClientInfo *UserInfo   `json:"ClientInfo,omitempty"`
	CursorData *CursorData `json:"CursorData,omitempty"`
}

// UserOperation is an operation attributed to whoever made it.
type UserOperation struct {
	ID        uint64    `json:"id"`
	Operation *ot.OpSeq `json:"operation"`
}

// HistoryMsg is a contiguous run of operations beginning at revision Start.
type HistoryMsg struct {
	Start      int             `json:"start"`
	Operations []UserOperation `json:"operations"`
}

// UserInfoMsg announces a participant. A nil Info means they left — it must
// serialise as an explicit null, so no omitempty here.
type UserInfoMsg struct {
	ID   uint64    `json:"id"`
	Info *UserInfo `json:"info"`
}

// UserCursorMsg announces where a participant is.
type UserCursorMsg struct {
	ID   uint64     `json:"id"`
	Data CursorData `json:"data"`
}

// ServerMsg is anything the server may send.
type ServerMsg struct {
	Identity   *uint64        `json:"Identity,omitempty"`
	History    *HistoryMsg    `json:"History,omitempty"`
	UserInfo   *UserInfoMsg   `json:"UserInfo,omitempty"`
	UserCursor *UserCursorMsg `json:"UserCursor,omitempty"`
}
