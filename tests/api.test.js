'use strict';

// Set before any module reads configuration. dotenv does not override a key
// that is already present, so this keeps the suite off a real database: the
// persistence routes should answer 503, and nothing should open a socket.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { PortfolioService } = require('../src/services/portfolioService');
const { MarketDataService } = require('../src/services/marketData');
const { createRateLimiter } = require('../src/middleware/rateLimit');

/**
 * Integration tests over the real Express stack - routing, validation, error
 * shaping and headers - with only the network boundary stubbed. No supertest:
 * the server listens on an ephemeral port and the built-in fetch drives it.
 */

/** Deterministic price series, so assertions do not depend on live markets. */
function syntheticCloses(seed, length = 60) {
    const closes = [100 + seed];
    for (let i = 1; i < length; i++) {
        // A fixed pseudo-random walk: same series on every run.
        const drift = Math.sin((i + seed) * 0.7) * 1.5 + 0.05;
        closes.push(Number((closes[i - 1] * (1 + drift / 100)).toFixed(4)));
    }
    return closes;
}

function stubbedPortfolioService() {
    const fetchImpl = async (url) => {
        const symbol = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
        if (symbol === 'NOSUCH') {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        const seed = symbol.charCodeAt(0) % 17;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                chart: { result: [{ indicators: { quote: [{ close: syntheticCloses(seed) }] } }] }
            })
        };
    };
    return new PortfolioService({
        marketData: new MarketDataService({ fetchImpl, sleep: async () => {} })
    });
}

/** Start the app on an ephemeral port; returns a client bound to its base URL. */
async function withServer(run, { rateLimiter } = {}) {
    const app = createApp({ portfolioService: stubbedPortfolioService(), rateLimiter });
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const client = async (path, options = {}) => {
        const response = await fetch(`${base}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        const text = await response.text();
        return {
            status: response.status,
            headers: response.headers,
            body: text ? JSON.parse(text) : null
        };
    };

    try {
        await run(client);
    } finally {
        app.locals.rateLimiter?.stop?.();
        await new Promise(resolve => server.close(resolve));
    }
}

const VALID = { assets: ['AAPL', 'MSFT'], weights: [0.6, 0.4] };

test('GET /health reports liveness without touching dependencies', async () => {
    await withServer(async (client) => {
        const res = await client('/health');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
        assert.ok(typeof res.body.uptimeSeconds === 'number');
    });
});

test('GET /ready reports dependency state and cache statistics', async () => {
    await withServer(async (client) => {
        const res = await client('/ready');
        assert.equal(res.status, 200);
        assert.equal(res.body.dependencies.database.status, 'not_configured');
        assert.ok(res.body.marketDataCache, 'cache stats should be exposed');
    });
});

test('POST /api/portfolio returns numeric metrics, not preformatted strings', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', { method: 'POST', body: VALID });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'success');
        assert.equal(typeof res.body.metrics.expectedAnnualReturn, 'number');
        assert.equal(typeof res.body.metrics.annualVolatility, 'number');
        assert.equal(typeof res.body.metrics.sharpeRatio, 'number');
        // Percentage strings remain available as a convenience.
        assert.match(res.body.formatted.expectedAnnualReturn, /%$/);
    });
});

test('the response still carries the legacy fields the previous client reads', async () => {
    // Guards the rollout window in which the old client talks to the new API.
    // Delete alongside those fields once the new client has shipped.
    await withServer(async (client) => {
        const res = await client('/api/portfolio', { method: 'POST', body: VALID });

        assert.match(res.body.expected_portfolio_return, /^-?\d+\.\d{2}%$/);
        assert.equal(typeof res.body.message, 'string');
        assert.ok(Array.isArray(res.body.assets));
        assert.ok(Array.isArray(res.body.weights));
        // The legacy string must agree with the numeric metric it mirrors.
        assert.equal(
            res.body.expected_portfolio_return,
            `${(res.body.metrics.expectedAnnualReturn * 100).toFixed(2)}%`
        );
    });
});

test('POST /api/portfolio includes a per-asset breakdown and correlation matrix', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', { method: 'POST', body: VALID });

        assert.equal(res.body.breakdown.length, 2);
        assert.deepEqual(res.body.breakdown.map(a => a.ticker), ['AAPL', 'MSFT']);
        for (const asset of res.body.breakdown) {
            assert.ok(asset.maxDrawdown >= 0);
            assert.equal(typeof asset.riskContribution, 'number');
        }

        assert.equal(res.body.correlationMatrix.length, 2);
        assert.equal(res.body.correlationMatrix[0][0], 1);
        assert.equal(res.body.correlationMatrix[0][1], res.body.correlationMatrix[1][0]);
    });
});

test('POST /api/portfolio rejects weights that do not sum to 1.0', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', {
            method: 'POST',
            body: { assets: ['AAPL', 'MSFT'], weights: [0.6, 0.6] }
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.code, 'VALIDATION_ERROR');
        assert.match(res.body.message, /must sum to 1.0/);
    });
});

test('POST /api/portfolio surfaces an unknown ticker as a client error', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', {
            method: 'POST',
            body: { assets: ['AAPL', 'NOSUCH'], weights: [0.5, 0.5] }
        });

        assert.equal(res.status, 502);
        assert.match(res.body.message, /NOSUCH/);
    });
});

test('POST /api/options/crr prices and includes the analytic reference', async () => {
    await withServer(async (client) => {
        const res = await client('/api/options/crr', {
            method: 'POST',
            body: { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, N: 500, optionType: 'call' }
        });

        assert.equal(res.status, 200);
        assert.ok(Math.abs(res.body.presentValue - 10.4506) < 0.01);
        assert.equal(res.body.reference.model, 'black-scholes');
        assert.ok(res.body.reference.absoluteDifference < 0.01);
        assert.equal(typeof res.body.greeks.delta, 'number');
    });
});

test('POST /api/options/crr caps the step count to bound CPU work', async () => {
    await withServer(async (client) => {
        const res = await client('/api/options/crr', {
            method: 'POST',
            body: { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, N: 10_000_000, optionType: 'call' }
        });

        assert.equal(res.status, 400);
        assert.match(res.body.message, /may not exceed/);
    });
});

test('POST /api/options/black-scholes prices the closed form', async () => {
    await withServer(async (client) => {
        const res = await client('/api/options/black-scholes', {
            method: 'POST',
            body: { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, optionType: 'call' }
        });

        assert.equal(res.status, 200);
        assert.ok(Math.abs(res.body.presentValue - 10.450584) < 1e-3);
        assert.ok(res.body.greeks.vega > 0);
    });
});

test('persistence routes report 503 when no database is configured', async () => {
    await withServer(async (client) => {
        const saved = await client('/api/save', {
            method: 'POST',
            body: { name: 'Test', ...VALID }
        });
        assert.equal(saved.status, 503);
        assert.equal(saved.body.code, 'DATABASE_UNAVAILABLE');

        const listed = await client('/api/portfolios');
        assert.equal(listed.status, 503);
    });
});

test('an unmatched route returns a structured 404', async () => {
    await withServer(async (client) => {
        const res = await client('/api/does-not-exist');
        assert.equal(res.status, 404);
        assert.equal(res.body.code, 'NOT_FOUND');
    });
});

test('every response carries a correlation id and security headers', async () => {
    await withServer(async (client) => {
        const res = await client('/health');

        assert.ok(res.headers.get('x-request-id'), 'X-Request-Id must be echoed');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(res.headers.get('x-powered-by'), null, 'framework version must not be advertised');
    });
});

test('a supplied request id is preserved for end-to-end tracing', async () => {
    await withServer(async (client) => {
        const res = await client('/health', { headers: { 'X-Request-Id': 'trace-me-123' } });
        assert.equal(res.headers.get('x-request-id'), 'trace-me-123');
    });
});

test('an error response carries the request id but never a stack trace', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', {
            method: 'POST',
            body: { assets: ['AAPL'], weights: [1] }
        });

        assert.equal(res.status, 400);
        assert.ok(res.body.requestId);
        assert.equal(res.body.stack, undefined);
    });
});

test('malformed JSON is rejected as a client error, not a crash', async () => {
    await withServer(async (client) => {
        const res = await client('/api/portfolio', { method: 'POST' });
        assert.ok(res.status >= 400 && res.status < 500);
    });
});

test('the rate limiter returns 429 with standard headers once the quota is spent', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    await withServer(async (client) => {
        const body = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, N: 10, optionType: 'call' };

        for (let i = 0; i < 3; i++) {
            const ok = await client('/api/options/crr', { method: 'POST', body });
            assert.equal(ok.status, 200, `request ${i + 1} should be within quota`);
            assert.equal(ok.headers.get('ratelimit-limit'), '3');
        }

        const blocked = await client('/api/options/crr', { method: 'POST', body });
        assert.equal(blocked.status, 429);
        assert.equal(blocked.body.code, 'RATE_LIMITED');
        assert.ok(blocked.headers.get('retry-after'), 'Retry-After must tell the client when to return');
    }, { rateLimiter: limiter });
});

test('the market data cache means repeated analyses hit the upstream once', async () => {
    await withServer(async (client) => {
        await client('/api/portfolio', { method: 'POST', body: VALID });
        const second = await client('/api/portfolio', { method: 'POST', body: VALID });
        assert.equal(second.status, 200);

        const ready = await client('/ready');
        assert.ok(ready.body.marketDataCache.hits >= 2, 'the second analysis should be served from cache');
    });
});
