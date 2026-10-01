import { HighlightProvider } from './highlight/context'
import { SessionList } from './shell/SessionList'
import { SessionPage } from './shell/SessionPage'

export function App() {
  const match = window.location.pathname.match(/^\/s\/(s_[0-9a-f]+)\/?$/)
  return <HighlightProvider>{match ? <SessionPage sid={match[1]} /> : <SessionList />}</HighlightProvider>
}
