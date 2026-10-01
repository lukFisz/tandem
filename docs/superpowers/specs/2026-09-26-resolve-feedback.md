# Resolve and end-session feedback

Decided in chat after the demo 3 session.

1. **Conclusion on top of a resolved thread.** On a resolved thread, the conclusion card renders right under the thread title instead of at the bottom. Open threads keep it at the bottom, above the composer.
2. **Confirm a resolved thread in the sidebar.** Resolving a thread auto-advances to the next one, so the confirmation lives in the left nav: when a thread becomes resolved, its ✓ pops in with a short green flash. This plays whenever the thread's status changes to resolved while the page is open (user action or not), never on the initial load or on reconnect.
3. **Confirm End session with a toast.** After End session is confirmed and the request succeeds, show a short toast "✓ Session ended" using the existing toast component.

All animations honor `prefers-reduced-motion` (no motion; the state change still shows). No Go changes, no new dependencies.
