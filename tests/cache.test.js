'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TtlCache } = require('../src/utils/cache');

test('a value is returned before its TTL expires and gone afterwards', () => {
    let now = 0;
    const cache = new TtlCache({ ttlMs: 100, clock: () => now });

    cache.set('k', 'v');
    assert.equal(cache.get('k'), 'v');

    now = 99;
    assert.equal(cache.get('k'), 'v');

    now = 101;
    assert.equal(cache.get('k'), undefined);
});

test('eviction removes the least recently used entry once the cap is exceeded', () => {
    const cache = new TtlCache({ ttlMs: 10_000, maxEntries: 3 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');       // promote 'a', making 'b' the least recently used
    cache.set('d', 4);    // exceeds the cap

    assert.equal(cache.size, 3);
    assert.equal(cache.get('b'), undefined, 'the LRU entry should have been evicted');
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('d'), 4);
});

test('resolve computes on a miss and reuses the value on a hit', async () => {
    let calls = 0;
    const cache = new TtlCache({ ttlMs: 10_000 });
    const producer = async () => { calls += 1; return 'computed'; };

    assert.equal(await cache.resolve('k', producer), 'computed');
    assert.equal(await cache.resolve('k', producer), 'computed');
    assert.equal(calls, 1);
});

test('concurrent resolves for one key share a single producer call', async () => {
    let calls = 0;
    const cache = new TtlCache({ ttlMs: 10_000 });
    const producer = async () => {
        calls += 1;
        await new Promise(resolve => setImmediate(resolve));
        return calls;
    };

    const results = await Promise.all(
        Array.from({ length: 50 }, () => cache.resolve('same', producer))
    );

    assert.equal(calls, 1);
    assert.ok(results.every(r => r === 1));
    assert.equal(cache.snapshot().coalesced, 49);
});

test('a rejected producer is not cached and does not wedge the key', async () => {
    const cache = new TtlCache({ ttlMs: 10_000 });

    await assert.rejects(() => cache.resolve('k', async () => { throw new Error('boom'); }));
    // The in-flight entry must have been cleared, or every later call would
    // receive the same rejected promise forever.
    assert.equal(await cache.resolve('k', async () => 'recovered'), 'recovered');
});

test('distinct keys resolve independently', async () => {
    const cache = new TtlCache({ ttlMs: 10_000 });
    const [a, b] = await Promise.all([
        cache.resolve('a', async () => 1),
        cache.resolve('b', async () => 2)
    ]);
    assert.equal(a, 1);
    assert.equal(b, 2);
    assert.equal(cache.size, 2);
});

test('upstreamCalls counts producer runs, not lookups that missed', async () => {
    const cache = new TtlCache({ ttlMs: 10_000 });
    const producer = async () => {
        await new Promise(resolve => setImmediate(resolve));
        return 'value';
    };

    // Two distinct keys, 25 concurrent callers each: 50 misses, 2 real calls.
    await Promise.all([
        ...Array.from({ length: 25 }, () => cache.resolve('a', producer)),
        ...Array.from({ length: 25 }, () => cache.resolve('b', producer))
    ]);

    const stats = cache.snapshot();
    assert.equal(stats.misses, 50, 'every lookup missed');
    assert.equal(stats.upstreamCalls, 2, 'but only one producer run per key');
    assert.equal(stats.coalesced, 48);
    // 48 of 50 misses avoided an upstream call.
    assert.equal(stats.deduplication, 0.96);
});

test('upstreamCalls does not increment for a cached read', async () => {
    const cache = new TtlCache({ ttlMs: 10_000 });
    await cache.resolve('k', async () => 1);
    await cache.resolve('k', async () => 2);
    await cache.resolve('k', async () => 3);

    assert.equal(cache.snapshot().upstreamCalls, 1);
    assert.equal(cache.snapshot().hits, 2);
});

test('snapshot reports a hit rate', async () => {
    const cache = new TtlCache({ ttlMs: 10_000 });
    cache.set('k', 1);
    cache.get('k');
    cache.get('k');
    cache.get('missing');

    const stats = cache.snapshot();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    // snapshot() rounds to 4dp so the value stays readable in a JSON health
    // response; the tolerance here matches that deliberate rounding.
    assert.ok(Math.abs(stats.hitRate - 2 / 3) < 1e-4);
});

test('the constructor rejects a non-positive TTL', () => {
    assert.throws(() => new TtlCache({ ttlMs: 0 }), /positive ttlMs/);
    assert.throws(() => new TtlCache({}), /positive ttlMs/);
});
