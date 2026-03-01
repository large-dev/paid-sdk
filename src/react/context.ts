import { createContext, useContext } from 'react'
import type { PaidClient } from '../core/client'
import type { PaidConfig } from '../core/types'

export interface PaidContextValue {
  client: PaidClient
  config: PaidConfig
  chainId: number
}

export const PaidContext = createContext<PaidContextValue | null>(null)

export function usePaidContext(): PaidContextValue {
  const ctx = useContext(PaidContext)
  if (!ctx) {
    throw new Error(
      'usePaidContext must be used within a <PaidProvider>. ' +
      'Wrap your app with <PaidProvider publicKey="pk_...">.',
    )
  }
  return ctx
}
