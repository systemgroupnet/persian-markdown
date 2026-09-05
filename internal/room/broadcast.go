package room

import "sync"

// broadcast is a one-to-many wakeup with no queue and no per-listener state.
//
// Listeners wait on a channel that is closed and replaced whenever the room
// changes. Because it carries no payload, a slow listener cannot make the room
// block or accumulate memory — it simply observes a later state when it next
// looks. That property is what makes it safe for a room to be shared by an
// arbitrary number of sockets of wildly differing speeds. It is the same role
// tokio's Notify plays in Rustpad.
//
// Correct use requires taking the channel *before* reading room state:
//
//	ch := b.wait()
//	send(currentState())
//	<-ch
//
// Reading first would leave a window in which an update lands between the read
// and the wait, and the listener would sleep through it.
type broadcast struct {
	mu sync.Mutex
	ch chan struct{}
}

func newBroadcast() *broadcast {
	return &broadcast{ch: make(chan struct{})}
}

// wait returns a channel closed on the next publish.
func (b *broadcast) wait() <-chan struct{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.ch
}

// publish wakes every current listener.
func (b *broadcast) publish() {
	b.mu.Lock()
	defer b.mu.Unlock()
	close(b.ch)
	b.ch = make(chan struct{})
}
