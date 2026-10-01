// Minimal stand-in for EventSource (jsdom has none). Install with vi.stubGlobal('EventSource', FakeEventSource).
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = 0
  onerror: ((e: Event) => void) | null = null
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>()

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.readyState = FakeEventSource.CLOSED
  }
  emit(type: string, data: string) {
    this.readyState = FakeEventSource.OPEN
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data }))
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING
    this.onerror?.(new Event('error'))
  }
}
