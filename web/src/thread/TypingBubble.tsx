// TypingBubble is the AI-side working indicator shown at the end of a thread's timeline while the
// AI is replying (round 3 #6): a pixel diamond, a 3x3 grid of pixels set on its corner with a
// ripple pulsing out from the centre (no bubble, no visible text). The motion is CSS (transform and
// opacity only) and pauses on a still frame under prefers-reduced-motion. `role="status"`
// does not take its accessible name from its content (unlike, say, a button), so aria-label
// still supplies the name — but a visually hidden span with the same text is also present as the
// live region's actual content, since some assistive tech announces a live region's content on
// update rather than (or in addition to) its label (review round 3, Minor). The diamond stays
// decorative.
// With quietMinutes set, the agent has gone silent and the bubble says so in words instead (feature review t_6).
// `label` names the status (default "AI is replying"). With `text`, that text is shown before the
// diamond instead of being visually hidden (the stage's "waiting for the summary", demo2 follow-up 5).
export function TypingBubble({
  quietMinutes = null,
  label = 'AI is replying',
  text,
}: {
  quietMinutes?: number | null
  label?: string
  text?: string
}) {
  if (quietMinutes !== null) {
    const quiet = `AI quiet for ${quietMinutes}m, it may have stopped`
    const full = text ? `${text} ${quiet}` : quiet
    return (
      <div className="typing-bubble is-quiet" role="status" aria-label={full}>
        {full}
      </div>
    )
  }
  return (
    <div className={text ? 'typing-bubble has-text' : 'typing-bubble'} role="status" aria-label={label}>
      {text ? <span className="typing-text">{text}</span> : <span className="visually-hidden">{label}</span>}
      <span className="typing-diamond" aria-hidden="true">
        <span className="px-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      </span>
    </div>
  )
}
