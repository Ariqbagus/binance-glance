import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import './style.css'
import {
  PAIRS,
  fetchQuotes,
  pushSample,
  windowMovePct,
  isAlerting,
  formatPrice,
  formatPriceShort,
  formatPct,
  type CoinQuote,
  type PriceSample,
} from './market'

/**
 * Binance Glance - one glanceable screen for Even G2.
 *
 * Read-only Binance public market data for a 3-coin watchlist.
 * No API key, no account, no orders, no user funds, no financial advice:
 * the app only displays prices and lets the user set a move-alert level.
 *
 * Gestures (temple touchpad or R1 ring):
 *   Tap          -> focus the next coin (shown large)
 *   Swipe up     -> raise the alert level by 0.10%
 *   Swipe down   -> lower the alert level by 0.10%
 *   Double tap   -> exit (system confirmation dialog)
 */

const POLL_MS = 15_000
const WINDOW_MS = 5 * 60_000 // alert window: 5 minutes
const MIN_SPAN_MS = 60_000 // need >= 60s of samples before alerts can fire
const SAMPLE_KEEP_MS = WINDOW_MS + 60_000
const THRESHOLD_STEP = 0.1
const THRESHOLD_MIN = 0.1
const THRESHOLD_MAX = 5.0

// ---------------------------------------------------------------- state

const quotes = new Map<string, CoinQuote>()
const samples = new Map<string, PriceSample[]>(
  PAIRS.map((p) => [p, [] as PriceSample[]]),
)
let focusIndex = 0
let thresholdPct = 0.5
let lastError: string | null = null
let updatedAt: Date | null = null

function focusQuote(): CoinQuote | undefined {
  return quotes.get(PAIRS[focusIndex])
}

function moveFor(symbol: string): number | null {
  return windowMovePct(samples.get(symbol) ?? [], WINDOW_MS, MIN_SPAN_MS)
}

function alertingSymbols(): string[] {
  return PAIRS.filter((p) => isAlerting(moveFor(p), thresholdPct)).map(
    (p) => p.replace(/USDT$/, ''),
  )
}

// ---------------------------------------------------------------- content

function focusContent(): string {
  const q = focusQuote()
  if (!q) {
    return lastError
      ? `BINANCE GLANCE\n\nCould not load prices.\n${lastError}\nRetrying...`
      : 'BINANCE GLANCE\n\nLoading prices...'
  }
  const move = moveFor(q.symbol)
  const alert = isAlerting(move, thresholdPct)
  const lines = [
    alert
      ? `!! MOVE ALERT !!  ${q.base} / USDT`
      : `${q.base} / USDT        ${focusIndex + 1} of ${PAIRS.length}`,
    formatPrice(q.price),
    `24h ${formatPct(q.change24hPct)}    5m ${
      move === null ? '--' : formatPct(move)
    }`,
    `H ${formatPriceShort(q.high24h)}   L ${formatPriceShort(q.low24h)}`,
  ]
  return lines.join('\n')
}

function watchContent(): string {
  const alerting = new Set(alertingSymbols())
  return PAIRS.filter((_, i) => i !== focusIndex)
    .map((pair) => {
      const q = quotes.get(pair)
      if (!q) return `${pair.replace(/USDT$/, '')}  loading...`
      const mark = alerting.has(q.base) ? '! ' : '  '
      return `${mark}${q.base}  ${formatPriceShort(q.price)}  ${formatPct(
        q.change24hPct,
      )} 24h`
    })
    .join('\n')
}

function statusContent(): string {
  const alerting = alertingSymbols()
  const level = `Alert level: ${thresholdPct.toFixed(2)}% in 5 min`
  if (alerting.length > 0) {
    const detail = alerting
      .map((base) => {
        const m = moveFor(`${base}USDT`)
        return `${base} ${m === null ? '' : formatPct(m)}`
      })
      .join('  ')
    return `** ALERT: ${detail} **\n${level}`
  }
  if (lastError) return `${level}\nUpdate failed - showing last prices`
  const time = updatedAt
    ? updatedAt.toLocaleTimeString('en-GB', { hour12: false })
    : '--:--:--'
  return `${level}\nTap: next coin  Swipe: level  ${time}`
}

// ---------------------------------------------------------------- web preview

const el = {
  focus: document.querySelector<HTMLPreElement>('#focus')!,
  watch: document.querySelector<HTMLPreElement>('#watch')!,
  status: document.querySelector<HTMLPreElement>('#status')!,
  statusBar: document.querySelector<HTMLDivElement>('#mode-line')!,
}

function renderWeb() {
  el.focus.textContent = focusContent()
  el.watch.textContent = watchContent()
  el.status.textContent = statusContent()
  el.status.classList.toggle('alerting', alertingSymbols().length > 0)
}

// ---------------------------------------------------------------- glasses

let bridge: EvenAppBridge | null = null

async function renderGlasses() {
  if (!bridge) return
  const alerting = alertingSymbols().length > 0
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'focus',
      content: focusContent(),
      textColor: 4,
    }),
  )
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 2,
      containerName: 'watch',
      content: watchContent(),
      textColor: 3,
    }),
  )
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 3,
      containerName: 'status',
      content: statusContent(),
      textColor: alerting ? 4 : 2,
    }),
  )
}

function renderAll() {
  renderWeb()
  void renderGlasses()
}

async function startGlasses(b: EvenAppBridge) {
  if (bridge) return
  bridge = b
  el.statusBar.textContent = 'Mode: Even G2 glasses (SDK bridge connected)'
  const page = {
    containerTotalNum: 3,
    textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 134,
          borderWidth: 2,
          borderColor: 10,
          paddingLength: 8,
          containerID: 1,
          containerName: 'focus',
          content: focusContent(),
          textColor: 4,
          isEventCapture: 1, // the one container that receives gestures
        }),
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 138,
          width: 576,
          height: 66,
          borderWidth: 1,
          borderColor: 5,
          paddingLength: 6,
          containerID: 2,
          containerName: 'watch',
          content: watchContent(),
          textColor: 3,
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 208,
          width: 576,
          height: 70,
          borderWidth: 1,
          borderColor: 5,
          paddingLength: 6,
          containerID: 3,
          containerName: 'status',
          content: statusContent(),
          textColor: 2,
          isEventCapture: 0,
        }),
      ],
  }
  const result = await b.createStartUpPageContainer(
    new CreateStartUpPageContainer(page),
  )
  if ((result as unknown as number) !== 0) {
    // A startup page already exists for this session (e.g. the WebView
    // reloaded). Rebuilding the existing page is the correct re-entry path.
    const rebuilt = await b.rebuildPageContainer(
      new RebuildPageContainer(page),
    )
    if (!rebuilt) {
      console.error('createStartUpPageContainer failed:', result)
      el.statusBar.textContent = `Mode: glasses page failed to start (code ${String(result)}) - web preview still live`
    }
  }

  b.onEvenHubEvent((event) => {
    // Only container 1 captures input, so events can only come from it;
    // accept whichever payload slot the host used (text/list/sys).
    const type =
      event.textEvent?.eventType ??
      event.listEvent?.eventType ??
      event.sysEvent?.eventType
    switch (type) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        // CLICK_EVENT is protobuf 0, which hosts variously deliver as an
        // explicit textEvent, or as a bare sysEvent carrying only
        // eventSource (the simulator does the latter). Both are taps.
        // A payload-less event with no source at all is a system notice.
        if (
          !event.textEvent &&
          !event.listEvent &&
          event.sysEvent?.eventSource === undefined
        ) {
          return
        }
        noteGesture('tap')
        nextCoin()
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        noteGesture('swipe up')
        adjustThreshold(THRESHOLD_STEP)
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        noteGesture('swipe down')
        adjustThreshold(-THRESHOLD_STEP)
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        noteGesture('double tap')
        // Mode 1 = system exit-confirmation dialog (required on root page).
        void b.shutDownPageContainer(1)
        break
    }
  })
}

// ---------------------------------------------------------------- actions

/** Echo the last glasses gesture on the phone-side companion view. */
function noteGesture(name: string) {
  if (bridge) {
    el.statusBar.textContent = `Mode: Even G2 glasses (SDK bridge connected) - last gesture: ${name}`
  }
}

function nextCoin() {
  focusIndex = (focusIndex + 1) % PAIRS.length
  renderAll()
}

function adjustThreshold(delta: number) {
  const next = Math.round((thresholdPct + delta) * 10) / 10
  thresholdPct = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, next))
  renderAll()
}

// Web-preview buttons mirror the glasses gestures.
document.querySelector('#btn-next')!.addEventListener('click', nextCoin)
document
  .querySelector('#btn-up')!
  .addEventListener('click', () => adjustThreshold(THRESHOLD_STEP))
document
  .querySelector('#btn-down')!
  .addEventListener('click', () => adjustThreshold(-THRESHOLD_STEP))

// ---------------------------------------------------------------- data loop

async function tick() {
  try {
    const fresh = await fetchQuotes()
    const now = Date.now()
    for (const q of fresh) {
      quotes.set(q.symbol, q)
      pushSample(samples.get(q.symbol)!, q.price, now, SAMPLE_KEEP_MS)
    }
    updatedAt = new Date(now)
    lastError = null
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error('Price update failed:', err)
  }
  renderAll()
}

// ---------------------------------------------------------------- boot

renderWeb()
void tick()
setInterval(() => void tick(), POLL_MS)

// Connect to the glasses when the SDK bridge is available (simulator or
// real G2 via the Even app). In a plain browser nothing injects the bridge,
// so the app simply stays in web-preview mode with the same live data.
const bridgePromise = waitForEvenAppBridge()
const timeout = new Promise<null>((resolve) =>
  setTimeout(() => resolve(null), 2500),
)
const first = await Promise.race([bridgePromise, timeout])
if (first) {
  await startGlasses(first)
} else {
  el.statusBar.textContent =
    'Mode: web preview (no glasses bridge) - same live data, buttons mirror the gestures'
  // If the bridge arrives late (slow WebView init), still switch over.
  void bridgePromise.then((late) => {
    if (late) void startGlasses(late)
  })
}
