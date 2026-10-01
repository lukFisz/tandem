import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadTokenizer, plainTokenize, type Tokenize } from './tokenize'

const HighlightContext = createContext<Tokenize>(plainTokenize)

// HighlightProvider shows plain code immediately and swaps in Shiki once it has loaded.
export function HighlightProvider({ children }: { children: ReactNode }) {
  const [tokenize, setTokenize] = useState<Tokenize>(() => plainTokenize)
  useEffect(() => {
    let live = true
    loadTokenizer().then(
      (t) => live && setTokenize(() => t),
      (err) => console.warn('tdm: syntax highlighting unavailable', err),
    )
    return () => {
      live = false
    }
  }, [])
  return <HighlightContext.Provider value={tokenize}>{children}</HighlightContext.Provider>
}

export function useTokenize(): Tokenize {
  return useContext(HighlightContext)
}
