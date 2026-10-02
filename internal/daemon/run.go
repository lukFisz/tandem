package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/lukFisz/tandem/internal/store"
)

// Run serves the daemon until ctx is done, /api/shutdown is called, or it has been idle for cfg.IdleTimeout.
// Only one daemon may run per Home at a time (spec §7): Run holds an exclusive
// lock on Home/daemon.lock for its whole lifetime and fails fast if another
// daemon already holds it, so two racing auto-starts can never both proceed.
func Run(ctx context.Context, cfg Config) error {
	lockFile, err := acquireLock(filepath.Join(cfg.Home, "daemon.lock"))
	if err != nil {
		return err
	}
	defer releaseLock(lockFile)

	mgr, err := NewManager(cfg.Home)
	if err != nil {
		return err
	}
	defer mgr.Close()

	// I2: reuse the port recorded in Home/daemon.port (a file that, unlike daemon.json, is never
	// deleted — see store.WritePortHint) so a browser tab pointed at the old origin keeps
	// working, and a localStorage draft keyed by that origin survives a restart. Fall back to an
	// ephemeral port when the hint is absent, corrupt, answered by something else, or already
	// taken for listening.
	ln, err := listenReusingPreviousPort(cfg.Home)
	if err != nil {
		return err
	}
	cfg.Port = ln.Addr().(*net.TCPAddr).Port
	// Record the port we actually bound (whether reused or freshly assigned) so the next Run
	// can prefer it too, even across a clean shutdown that removes daemon.json.
	if err := store.WritePortHint(cfg.Home, cfg.Port); err != nil {
		ln.Close()
		return err
	}
	for _, tok := range []*string{&cfg.Token, &cfg.PageToken} {
		if *tok != "" {
			continue
		}
		var b [32]byte
		if _, err := rand.Read(b[:]); err != nil {
			return err
		}
		*tok = hex.EncodeToString(b[:])
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = 30 * time.Minute
	}

	ctx, stop := context.WithCancel(ctx)
	defer stop()
	srv := NewServer(cfg, mgr, stop)
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx }, // shutdown ends long polls
	}
	if err := store.WriteDaemonInfo(cfg.Home, store.DaemonInfo{Port: cfg.Port, PID: os.Getpid(), Version: cfg.Version, Token: cfg.Token, PageToken: cfg.PageToken}); err != nil {
		ln.Close()
		return err
	}
	defer store.RemoveDaemonInfo(cfg.Home, os.Getpid())

	go srv.watchIdle(ctx, stop)
	go mgr.watchProcesses(ctx.Done())
	errc := make(chan error, 1)
	go func() { errc <- httpSrv.Serve(ln) }()
	select {
	case <-ctx.Done():
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

// listenReusingPreviousPort tries to listen on the port recorded in Home/daemon.port (if any),
// and falls back to an OS-assigned ephemeral port when that port is absent, invalid, already
// answering (something else is listening — see addressIsAnswering), or fails to bind.
func listenReusingPreviousPort(home string) (net.Listener, error) {
	if port, err := store.ReadPortHint(home); err == nil && port > 0 {
		addr := fmt.Sprintf("127.0.0.1:%d", port)
		// On macOS, binding 127.0.0.1:port can succeed via SO_REUSEADDR even while another
		// process is listening on *:port — which would silently hijack that process's loopback
		// traffic instead of erroring. Dialing first catches that case (and the ordinary "our
		// own previous instance hasn't fully exited yet" case) before Listen ever gets a chance
		// to appear to succeed.
		if !addressIsAnswering(addr) {
			if ln, err := net.Listen("tcp", addr); err == nil {
				return ln, nil
			}
		}
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// addressIsAnswering is true when something accepts a TCP connection at addr.
func addressIsAnswering(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (s *Server) watchIdle(ctx context.Context, stop func()) {
	tick := time.NewTicker(max(s.cfg.IdleTimeout/10, 10*time.Millisecond))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if s.activity.Idle(s.cfg.IdleTimeout) {
				stop()
				return
			}
		}
	}
}
