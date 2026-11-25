/**
 * Binance Glance - market data layer.
 *
 * Read-only public market data from Binance's public REST API.
 * No API key, no account, no order endpoints, no user funds - ever.
 *
 * Endpoint order matters: `data-api.binance.vision` is Binance's official
 * market-data-only domain (it serves nothing but public data, which is
 * exactly the read-only surface this app is allowed to touch). The classic
 * `api.binance.com` host is kept as a fallback for regions where it works;
 * it returns HTTP 451 from restricted locations.
 */

export interface CoinQuote {
  /** Full pair, e.g. "BTCUSDT" */
  symbol: string
  /** Base asset, e.g. "BTC" */
  base: string
  price: number
  change24hPct: number
  high24h: number
  low24h: number
}

export interface PriceSample {
  t: number
  price: number
}

export const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const

const ENDPOINTS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
] as const

interface RawTicker {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  highPrice: string
  lowPrice: string
}

/** Fetch 24h tickers for the watchlist. Throws if every endpoint fails. */
export async function fetchQuotes(
  fetchFn: typeof fetch = fetch,
): Promise<CoinQuote[]> {
  const query = `/api/v3/ticker/24hr?symbols=${encodeURIComponent(
    JSON.stringify([...PAIRS]),
  )}`
  let lastError: unknown = null
  for (const base of ENDPOINTS) {
    try {
      const res = await fetchFn(`${base}${query}`)
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${base}`)
        continue
      }
      const raw = (await res.json()) as RawTicker[]
      const bySymbol = new Map(raw.map((r) => [r.symbol, r]))
      const quotes: CoinQuote[] = []
      for (const pair of PAIRS) {
        const r = bySymbol.get(pair)
        if (!r) continue
        quotes.push({
          symbol: pair,
          base: pair.replace(/USDT$/, ''),
          price: Number.parseFloat(r.lastPrice),
          change24hPct: Number.parseFloat(r.priceChangePercent),
          high24h: Number.parseFloat(r.highPrice),
          low24h: Number.parseFloat(r.lowPrice),
        })
      }
      if (quotes.length > 0) return quotes
      lastError = new Error(`Empty ticker response from ${base}`)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('All Binance endpoints failed')
}

/** Append a sample and drop anything older than maxAgeMs. Mutates the array. */
export function pushSample(
  samples: PriceSample[],
  price: number,
  t: number,
  maxAgeMs: number,
): void {
  samples.push({ t, price })
  while (samples.length > 0 && t - samples[0].t > maxAgeMs) samples.shift()
}

/**
 * Percent move between the oldest sample still inside the window and the
 * newest sample. Returns null until there are at least two samples spanning
 * at least `minSpanMs`, so a fresh app does not fire alerts on no history.
 */
export function windowMovePct(
  samples: PriceSample[],
  windowMs: number,
  minSpanMs: number,
): number | null {
  if (samples.length < 2) return null
  const newest = samples[samples.length - 1]
  let oldest = samples[0]
  for (const s of samples) {
    if (newest.t - s.t <= windowMs) {
      oldest = s
      break
    }
  }
  if (newest.t - oldest.t < minSpanMs) return null
  if (oldest.price <= 0) return null
  return ((newest.price - oldest.price) / oldest.price) * 100
}

/** True when the absolute window move meets or exceeds the threshold. */
export function isAlerting(movePct: number | null, thresholdPct: number): boolean {
  return movePct !== null && Math.abs(movePct) >= thresholdPct
}

const usd = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$60,175.59" - always 2 decimals; the watchlist pairs are all >= $1. */
export function formatPrice(n: number): string {
  return `$${usd.format(n)}`
}

/** "+0.43%" / "-1.20%" */
export function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}${Math.abs(n).toFixed(2)}%`
}

/** Compact price for one-line watchlist rows: "$60,176" */
export function formatPriceShort(n: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`
}
