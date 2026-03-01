import { useState, useCallback } from 'react'
import { PaidClient } from '../../core/client'
import type { TokenInfo, Address } from '../../core/types'
import { usePaidContext } from '../context'

export interface UsePaidTokensReturn {
  /** Available tokens with balances. */
  tokens: TokenInfo[]
  /** Loading state. */
  loading: boolean
  /** Error message if fetch failed. */
  error: string | null
  /**
   * Fetch token balances for a wallet.
   * Call this once you have the wallet address and session ID.
   */
  fetchTokens: (sessionId: string, walletAddress: Address) => Promise<TokenInfo[]>
  /**
   * Filter tokens to only those that can cover a USD amount.
   * Returns tokens sorted by USD balance descending.
   */
  filterByAmount: (tokens: TokenInfo[], targetUsd: number) => TokenInfo[]
}

/**
 * Hook for fetching and filtering token balances.
 *
 * @example
 * ```tsx
 * const { fetchTokens, filterByAmount } = usePaidTokens()
 *
 * const allTokens = await fetchTokens(sessionId, walletAddress)
 * const affordable = filterByAmount(allTokens, 25.00)
 * ```
 */
export function usePaidTokens(): UsePaidTokensReturn {
  const { client } = usePaidContext()
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTokens = useCallback(
    async (sessionId: string, walletAddress: Address): Promise<TokenInfo[]> => {
      setLoading(true)
      setError(null)

      try {
        const raw = await client.getWalletTokens(sessionId, walletAddress)

        // Normalize — server might return different shapes
        const data: TokenInfo[] = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as Record<string, unknown>)?.tokens)
            ? (raw as unknown as { tokens: TokenInfo[] }).tokens
            : []

        // Filter to non-zero balances, sorted by USD value
        const sorted = data
          .filter((t) => parseFloat(t.balanceUnits) > 0)
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .slice(0, 6)

        setTokens(sorted)
        return sorted
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch tokens'
        setError(msg)
        return []
      } finally {
        setLoading(false)
      }
    },
    [client],
  )

  const filterByAmount = useCallback(
    (tokenList: TokenInfo[], targetUsd: number): TokenInfo[] => {
      return tokenList.filter((t) => {
        if (t.rateUsdPerUnit <= 0) return false
        const sendAmount = PaidClient.computePayAmount(targetUsd, t)
        return parseFloat(t.balanceUnits) >= parseFloat(sendAmount)
      })
    },
    [],
  )

  return {
    tokens,
    loading,
    error,
    fetchTokens,
    filterByAmount,
  }
}
