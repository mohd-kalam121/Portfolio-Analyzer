'use strict';

const config = require('../config');
const { TtlCache } = require('../utils/cache');
const { UpstreamError, ValidationError } = require('../utils/errors');

/**
 * Market data client for the Yahoo Finance chart endpoint.
 *
 * The upstream is free, unauthenticated and aggressively rate-limited, so the
 * naive "fetch on every request" approach fails under any real traffic. Four
 * things guard it here:
 *
 *   1. TTL cache      - daily closes change once a day; serving a 15 minute old
 *                       copy is correct and removes almost all upstream calls.
 *   2. Single flight  - concurrent misses on one ticker share a single request
 *                       (handled inside TtlCache) instead of stampeding.
 *   3. Timeout        - an AbortController caps each attempt, so a hung upstream
 *                       cannot pin a request handler open indefinitely.
 *   4. Bounded retry  - exponential backoff with jitter on transient failures
 *                       (5xx, 429, network errors) but never on a 404, because
 *                       an unknown ticker will not become known by asking again.
 */

// Covers ordinary equities (AAPL), share classes (BRK-B), exchange suffixes
// (RELIANCE.NS), index symbols (^GSPC) and FX pairs (EURUSD=X), while excluding
// anything - slashes, query characters, whitespace - that could alter the shape
// of the request URL.
const TICKER_PATTERN = /^[A-Z0-9^][A-Z0-9.\-^=]{0,14}$/;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class MarketDataService {
    constructor(options = {}) {
        this.settings = { ...config.marketData, ...options };
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.cache = options.cache || new TtlCache({
            ttlMs: this.settings.cacheTtlMs,
            maxEntries: this.settings.cacheMaxEntries
        });
        this.sleep = options.sleep || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    }

    /** Reject anything that is not a plausible ticker before it reaches a URL. */
    static normaliseTicker(ticker) {
        if (typeof ticker !== 'string') {
            throw new ValidationError('Ticker must be a string');
        }
        const normalised = ticker.trim().toUpperCase();
        if (!TICKER_PATTERN.test(normalised)) {
            throw new ValidationError(`"${ticker}" is not a valid ticker symbol`);
        }
        return normalised;
    }

    buildUrl(ticker) {
        const { baseUrl, interval, range } = this.settings;
        const params = new URLSearchParams({ interval, range });
        return `${baseUrl}/${encodeURIComponent(ticker)}?${params.toString()}`;
    }

    /**
     * Historical daily closes for one ticker, cached and de-duplicated.
     * @returns {Promise<number[]>} closes in chronological order, nulls removed.
     */
    async getHistoricalPrices(ticker) {
        const symbol = MarketDataService.normaliseTicker(ticker);
        const key = `${symbol}:${this.settings.range}:${this.settings.interval}`;
        return this.cache.resolve(key, () => this.fetchWithRetry(symbol));
    }

    /**
     * Historical closes for many tickers, fetched concurrently.
     *
     * `allSettled` rather than `all` so one bad ticker produces a precise
     * message naming it, instead of an opaque failure of the whole batch.
     */
    async getHistoricalPricesBatch(tickers) {
        const results = await Promise.allSettled(
            tickers.map(t => this.getHistoricalPrices(t))
        );

        const failures = [];
        const series = results.map((result, i) => {
            if (result.status === 'fulfilled') return result.value;
            failures.push({ ticker: tickers[i], reason: result.reason?.message || 'unknown error' });
            return null;
        });

        if (failures.length > 0) {
            const summary = failures.map(f => `${f.ticker} (${f.reason})`).join('; ');
            throw new UpstreamError(`Could not retrieve market data for: ${summary}`);
        }
        return series;
    }

    async fetchWithRetry(symbol) {
        const { maxRetries, retryBaseDelayMs } = this.settings;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this.fetchOnce(symbol);
            } catch (error) {
                lastError = error;
                if (!error.retryable || attempt === maxRetries) break;

                // Exponential backoff with full jitter, so simultaneous clients
                // do not retry in lockstep and re-create the burst they caused.
                const ceiling = retryBaseDelayMs * Math.pow(2, attempt);
                await this.sleep(Math.random() * ceiling);
            }
        }
        throw lastError;
    }

    async fetchOnce(symbol) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);

        let response;
        try {
            response = await this.fetchImpl(this.buildUrl(symbol), {
                signal: controller.signal,
                headers: {
                    // The endpoint refuses requests without a browser-like UA.
                    'User-Agent': 'Mozilla/5.0 (compatible; QuantTerminal/1.0)',
                    Accept: 'application/json'
                }
            });
        } catch (cause) {
            // Network failure or abort: both are worth one more attempt.
            const error = new UpstreamError(
                cause.name === 'AbortError'
                    ? `Market data request for ${symbol} timed out`
                    : `Market data request for ${symbol} failed`
            );
            error.retryable = true;
            error.cause = cause;
            throw error;
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const error = response.status === 404
                ? new ValidationError(`Unknown ticker symbol: ${symbol}`)
                : new UpstreamError(`Market data provider returned ${response.status} for ${symbol}`);
            error.retryable = RETRYABLE_STATUS.has(response.status);
            throw error;
        }

        let payload;
        try {
            payload = await response.json();
        } catch (cause) {
            const error = new UpstreamError(`Malformed market data response for ${symbol}`);
            error.retryable = true;
            throw error;
        }

        return MarketDataService.extractCloses(payload, symbol);
    }

    /**
     * Pull the close series out of the provider payload.
     *
     * Kept static and pure so the response-shape handling - the part most likely
     * to break when the upstream changes - is testable against fixtures without
     * any network involvement.
     */
    static extractCloses(payload, symbol) {
        const result = payload?.chart?.result?.[0];
        if (!result) {
            const providerMessage = payload?.chart?.error?.description;
            throw new UpstreamError(
                providerMessage
                    ? `Market data provider rejected ${symbol}: ${providerMessage}`
                    : `No market data returned for ${symbol}`
            );
        }

        const closes = result.indicators?.quote?.[0]?.close;
        if (!Array.isArray(closes)) {
            throw new UpstreamError(`No closing price series returned for ${symbol}`);
        }

        // Trading halts and holidays arrive as nulls; drop them rather than
        // letting a null propagate into the covariance arithmetic as NaN.
        const cleaned = closes.filter(price => typeof price === 'number' && Number.isFinite(price));

        if (cleaned.length < 2) {
            throw new UpstreamError(`Insufficient price history returned for ${symbol}`);
        }
        return cleaned;
    }

    stats() {
        return this.cache.snapshot();
    }
}

module.exports = { MarketDataService, TICKER_PATTERN };
