import { useMemo, type ReactNode } from 'react'
import { PaidClient } from '../core/client'
import { CHAIN_ID_BASE, type PaidConfig } from '../core/types'
import { PaidContext, type PaidContextValue } from './context'

export interface PaidProviderProps {
  /** Public API key for browser-safe calls. */
  publicKey: string
  /** Base URL of the Paid API. Defaults to https://api.getpaid.dev */
  baseUrl?: string
  /** Chain ID. Defaults to 8453 (Base). */
  chainId?: number
  children: ReactNode
}

/**
 * Provides the Paid SDK context to your app.
 *
 * @example
 * ```tsx
 * import { PaidProvider } from '@paid/sdk/react'
 *
 * function App() {
 *   return (
 *     <PaidProvider publicKey="pk_live_...">
 *       <YourApp />
 *     </PaidProvider>
 *   )
 * }
 * ```
 */
export function PaidProvider({
  publicKey,
  baseUrl,
  chainId,
  children,
}: PaidProviderProps) {
  const value = useMemo<PaidContextValue>(() => {
    const config: PaidConfig = {
      publicKey,
      baseUrl,
      chainId,
    }
    const client = new PaidClient(config)
    return {
      client,
      config,
      chainId: chainId ?? CHAIN_ID_BASE,
    }
  }, [publicKey, baseUrl, chainId])

  return (
    <PaidContext.Provider value={value}>
      {children}
    </PaidContext.Provider>
  )
}
