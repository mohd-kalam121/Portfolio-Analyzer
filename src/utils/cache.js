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
        this.stats = { hits: 0, misses: 0, evictions: 0, coalesced: 0 };
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

    /** Hit rate is the headline number worth logging or exposing on /health. */
    snapshot() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.store.size,
            hitRate: total === 0 ? 0 : Number((this.stats.hits / total).toFixed(4))
        };
    }
}

module.exports = { TtlCache };
