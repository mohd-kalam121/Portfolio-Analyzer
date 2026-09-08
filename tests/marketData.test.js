'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MarketDataService } = require('../src/services/marketData');
const { TtlCache } = require('../src/utils/cache');

/** Build a Yahoo-shaped chart payload. */
function chartPayload(closes) {
    return { chart: { result: [{ indicators: { quote: [{ close: closes }] } }] } };
}

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

/** A fetch stub that records calls and replays a queue of scripted responses. */
function stubFetch(responses) {
    const calls = [];
    const queue = [...responses];
    const impl = async (url, options) => {
        calls.push({ url, options });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (typeof next === 'function') return next();
        return next;
    };
    impl.calls = calls;
    return impl;
}

const noSleep = async () => {};

test('normaliseTicker uppercases and trims valid symbols', () => {
    assert.equal(MarketDataService.normaliseTicker(' msft '), 'MSFT');
    assert.equal(MarketDataService.normaliseTicker('brk-b'), 'BRK-B');
    assert.equal(MarketDataService.normaliseTicker('^gspc'), '^GSPC');
});

test('normaliseTicker rejects symbols that could alter the request URL', () => {
    for (const bad of ['', '   ', 'A B', 'AAPL/../admin', 'AAPL?foo=1', '<script>', 'TOOOOOOOOOOOOOLONG']) {
        assert.throws(() => MarketDataService.normaliseTicker(bad), /not a valid ticker/, `expected rejection of "${bad}"`);
    }
    assert.throws(() => MarketDataService.normaliseTicker(42), /must be a string/);
    assert.throws(() => MarketDataService.normaliseTicker(null), /must be a string/);
});

test('extractCloses strips nulls left by trading halts', () => {
    const closes = MarketDataService.extractCloses(chartPayload([100, null, 102, null, 104]), 'TEST');
    assert.deepEqual(closes, [100, 102, 104]);
});

test('extractCloses rejects a payload with no usable series', () => {
    assert.throws(() => MarketDataService.extractCloses({}, 'TEST'), /No market data/);
    assert.throws(() => MarketDataService.extractCloses(chartPayload(null), 'TEST'), /No closing price series/);
    assert.throws(() => MarketDataService.extractCloses(chartPayload([100]), 'TEST'), /Insufficient price history/);
});

test('extractCloses surfaces the provider error description when present', () => {
    const payload = { chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } };
    assert.throws(() => MarketDataService.extractCloses(payload, 'ZZZZ'), /may be delisted/);
});

test('a repeated request is served from cache without a second fetch', async () => {
    const fetchImpl = stubFetch([jsonResponse(chartPayload([100, 101, 102]))]);
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    await service.getHistoricalPrices('AAPL');
    await service.getHistoricalPrices('AAPL');
    await service.getHistoricalPrices('aapl'); // same symbol, different casing

    assert.equal(fetchImpl.calls.length, 1, 'expected exactly one upstream call');
    assert.equal(service.stats().hits, 2);
});

test('concurrent misses for one ticker collapse into a single upstream call', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const fetchImpl = async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise(resolve => setImmediate(resolve));
        inFlight -= 1;
        return jsonResponse(chartPayload([100, 101, 102]));
    };

    const service = new MarketDataService({ fetchImpl, sleep: noSleep });
    const results = await Promise.all(Array.from({ length: 20 }, () => service.getHistoricalPrices('MSFT')));

    assert.equal(maxConcurrent, 1, 'the thundering herd must be collapsed to one request');
    assert.equal(results.length, 20);
    results.forEach(series => assert.deepEqual(series, [100, 101, 102]));
});

test('an expired cache entry triggers a fresh fetch', async () => {
    let now = 1_000_000;
    const fetchImpl = stubFetch([jsonResponse(chartPayload([100, 101, 102]))]);
    const cache = new TtlCache({ ttlMs: 1000, clock: () => now });
    const service = new MarketDataService({ fetchImpl, cache, sleep: noSleep });

    await service.getHistoricalPrices('AAPL');
    now += 1500; // past the TTL
    await service.getHistoricalPrices('AAPL');

    assert.equal(fetchImpl.calls.length, 2);
});

test('a transient 503 is retried and then succeeds', async () => {
    const fetchImpl = stubFetch([
        jsonResponse({}, 503),
        jsonResponse({}, 503),
        jsonResponse(chartPayload([100, 101, 102]))
    ]);
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    const closes = await service.getHistoricalPrices('AAPL');

    assert.deepEqual(closes, [100, 101, 102]);
    assert.equal(fetchImpl.calls.length, 3, 'expected two retries before success');
});

test('a 404 is not retried, because an unknown ticker will not become known', async () => {
    const fetchImpl = stubFetch([jsonResponse({}, 404)]);
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    await assert.rejects(() => service.getHistoricalPrices('NOSUCH'), /Unknown ticker symbol/);
    assert.equal(fetchImpl.calls.length, 1, 'a 404 must not be retried');
});

test('retries are bounded and the final error propagates', async () => {
    const fetchImpl = stubFetch([jsonResponse({}, 500)]);
    const service = new MarketDataService({ fetchImpl, sleep: noSleep, maxRetries: 2 });

    await assert.rejects(() => service.getHistoricalPrices('AAPL'), /returned 500/);
    assert.equal(fetchImpl.calls.length, 3, 'initial attempt plus two retries');
});

test('a network failure is retried and reported as an upstream error', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
        attempts += 1;
        throw Object.assign(new Error('ECONNRESET'), { name: 'TypeError' });
    };
    const service = new MarketDataService({ fetchImpl, sleep: noSleep, maxRetries: 1 });

    await assert.rejects(() => service.getHistoricalPrices('AAPL'), /failed/);
    assert.equal(attempts, 2);
});

test('a hung upstream is aborted and surfaces as a timeout', async () => {
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const service = new MarketDataService({
        fetchImpl, sleep: noSleep, requestTimeoutMs: 20, maxRetries: 0
    });

    await assert.rejects(() => service.getHistoricalPrices('AAPL'), /timed out/);
});

test('a failed fetch is not cached, so a later request can succeed', async () => {
    let attempt = 0;
    const fetchImpl = async () => {
        attempt += 1;
        if (attempt <= 1) return jsonResponse({}, 404);
        return jsonResponse(chartPayload([100, 101, 102]));
    };
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    await assert.rejects(() => service.getHistoricalPrices('AAPL'));
    const closes = await service.getHistoricalPrices('AAPL');
    assert.deepEqual(closes, [100, 101, 102]);
});

test('a batch fetch names every ticker that failed', async () => {
    const fetchImpl = async (url) => (url.includes('BAD')
        ? jsonResponse({}, 404)
        : jsonResponse(chartPayload([100, 101, 102])));
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    await assert.rejects(
        () => service.getHistoricalPricesBatch(['AAPL', 'BAD', 'MSFT']),
        /BAD/
    );
});

test('a successful batch preserves input ordering', async () => {
    const fetchImpl = async (url) => jsonResponse(
        chartPayload(url.includes('AAPL') ? [10, 11, 12] : [20, 21, 22])
    );
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    const [first, second] = await service.getHistoricalPricesBatch(['AAPL', 'MSFT']);
    assert.deepEqual(first, [10, 11, 12]);
    assert.deepEqual(second, [20, 21, 22]);
});

test('the request carries a User-Agent, without which the provider refuses', async () => {
    const fetchImpl = stubFetch([jsonResponse(chartPayload([100, 101, 102]))]);
    const service = new MarketDataService({ fetchImpl, sleep: noSleep });

    await service.getHistoricalPrices('AAPL');
    assert.match(fetchImpl.calls[0].options.headers['User-Agent'], /Mozilla/);
});
