'use strict';

const { RateLimitError } = require('../utils/errors');

/**
 * Fixed-window rate limiter, in process memory.
 *
 * Every request here fans out to a free, rate-limited upstream, so an unbounded
 * client can exhaust the shared quota for everyone. This caps that.
 *
 * The tradeoff is stated deliberately: counters live in one process, so with
 * several instances the effective limit is per-instance, and a burst spanning a
 * window boundary can briefly pass 2x the limit. For a single-instance
 * deployment that is the right amount of machinery; a horizontally scaled
 * deployment would move the counter to Redis behind the same interface.
 */
function createRateLimiter({ windowMs, maxRequests, clock = Date.now } = {}) {
    const buckets = new Map();

    // Reclaim memory from clients that stopped calling, so the Map cannot grow
    // without bound. `unref` keeps this timer from holding the process open.
    const sweeper = setInterval(() => {
        const now = clock();
        for (const [key, bucket] of buckets) {
            if (now >= bucket.resetAt) buckets.delete(key);
        }
    }, windowMs);
    if (typeof sweeper.unref === 'function') sweeper.unref();

    function middleware(req, res, next) {
        const key = clientKey(req);
        const now = clock();

        let bucket = buckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;

        const remaining = Math.max(maxRequests - bucket.count, 0);
        res.set('RateLimit-Limit', String(maxRequests));
        res.set('RateLimit-Remaining', String(remaining));
        res.set('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

        if (bucket.count > maxRequests) {
            return next(new RateLimitError(Math.ceil((bucket.resetAt - now) / 1000)));
        }
        return next();
    }

    middleware.reset = () => buckets.clear();
    middleware.stop = () => clearInterval(sweeper);
    middleware.size = () => buckets.size;
    return middleware;
}

/**
 * Identify the caller.
 *
 * `req.ip` already respects the `trust proxy` setting configured on the app, so
 * behind Render or any reverse proxy this resolves to the real client address
 * rather than the load balancer.
 */
function clientKey(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { createRateLimiter };
