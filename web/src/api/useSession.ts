import { useEffect, useState } from 'react'
import { normalizeSnapshot, type Snapshot } from './types'

export type Connection = 'connecting' | 'open' | 'lost'

// useSession follows the daemon's SSE stream: a full snapshot on connect and after every change.
export function useSession(sid: string): { snapshot: Snapshot | null; connection: Connection } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sid}/stream`)
    es.addEventListener('state', (e) => {
      setSnapshot(normalizeSnapshot(JSON.parse((e as MessageEvent<string>).data)))
      setConnection('open')
    })
    es.onerror = () => setConnection(es.readyState === EventSource.CLOSED ? 'lost' : 'connecting')
    return () => es.close()
  }, [sid])
  return { snapshot, connection }
}
