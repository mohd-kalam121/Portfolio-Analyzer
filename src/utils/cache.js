'use strict';

/**
 * A bounded, TTL-based in-memory cache with single-flight de-duplication.
 *
 * Two properties matter for the market data feed in front of it:
 *
 *  1. TTL — daily closing prices are stale-tolerant, so serving a 15 minute old
 *     copy is correct and removes almost all upstream traffic.
 *  2. Single flight — when N concurrent requests miss on the same key, only the
 *     first performs the work; the rest await the same promise. Without this a
 *     cold cache plus a burst of traffic produces a thundering herd against a
 *     rate-limited upstream, which is exactly how the naive version failed.
 *
 * Eviction is insertion-ordered (Map iteration order) with promotion on read,
 * giving LRU behaviour without a linked list.
 */
class TtlCache {
    constructor({ ttlMs, maxEntries = 500, clock = Date.now } = {}) {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new Error('TtlCache requires a positive ttlMs');
        }
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.clock = clock;
        this.store = new Map();
        this.inFlight = new Map();

        // `misses` counts lookups that found nothing; `upstreamCalls` counts the
        // times the producer actually ran. They are different numbers, and the
        // gap between them is the whole point of this cache: 25 concurrent
        // requests for two uncached tickers produce 50 misses but only 2
        // upstream calls, the other 48 being coalesced onto those two.
        this.stats = { hits: 0, misses: 0, upstreamCalls: 0, coalesced: 0, evictions: 0 };
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            this.stats.misses += 1;
            return undefined;
        }
        if (this.clock() > entry.expiresAt) {
            this.store.delete(key);
            this.stats.misses += 1;
            return undefined;
        }
        // Promote to most-recently-used.
        this.store.delete(key);
        this.store.set(key, entry);
        this.stats.hits += 1;
        return entry.value;
    }

    set(key, value) {
        if (this.store.has(key)) this.store.delete(key);
        this.store.set(key, { value, expiresAt: this.clock() + this.ttlMs });
        while (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            this.store.delete(oldest);
            this.stats.evictions += 1;
        }
        return value;
    }

    /**
     * Return the cached value for `key`, or compute it via `producer`.
     * Concurrent callers for the same key share one `producer` invocation.
     */
    async resolve(key, producer) {
        const cached = this.get(key);
        if (cached !== undefined) return cached;

        const pending = this.inFlight.get(key);
        if (pending) {
            this.stats.coalesced += 1;
            return pending;
        }

        this.stats.upstreamCalls += 1;

        const promise = (async () => producer())()
            .then(value => {
                this.set(key, value);
                return value;
            })
            .finally(() => {
                this.inFlight.delete(key);
            });

        this.inFlight.set(key, promise);
        return promise;
    }

    clear() {
        this.store.clear();
        this.inFlight.clear();
    }

    get size() {
        return this.store.size;
    }

    /**
     * Cache effectiveness, for logging or a readiness endpoint.
     *
     * `hitRate` is the share of lookups served from the store. `deduplication`
     * is the share of misses that avoided an upstream call by joining one
     * already in flight - the number that shows single-flight working, which a
     * hit rate alone does not reveal.
     */
    snapshot() {
        const lookups = this.stats.hits + this.stats.misses;
        const { misses, coalesced } = this.stats;
        return {
            ...this.stats,
            size: this.store.size,
            hitRate: lookups === 0 ? 0 : Number((this.stats.hits / lookups).toFixed(4)),
            deduplication: misses === 0 ? 0 : Number((coalesced / misses).toFixed(4))
        };
    }
}

module.exports = { TtlCache };
