'use strict';

require('dotenv').config();

/**
 * Centralised, validated configuration.
 *
 * Every tunable lives here rather than being read from `process.env` at the
 * point of use, so the full surface of environment coupling is visible in one
 * file and the process fails fast on a bad deployment instead of throwing a
 * confusing error on the first request.
 */

function int(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be an integer, received "${raw}"`);
    }
    return parsed;
}

function bool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const env = process.env.NODE_ENV || 'development';

const config = {
    env,
    isProduction: env === 'production',
    isTest: env === 'test',

    port: int('PORT', 3000),

    database: {
        connectionString: process.env.DATABASE_URL,
        // TLS certificate verification stays ON. A managed Postgres provider
        // (Neon, RDS, Supabase) presents a certificate signed by a public CA,
        // which Node validates against its bundled trust store. Supply
        // DATABASE_CA_CERT only for a provider using a private CA.
        ssl: {
            rejectUnauthorized: bool('DATABASE_SSL_STRICT', true),
            ca: process.env.DATABASE_CA_CERT || undefined
        },
        poolMax: int('DATABASE_POOL_MAX', 10),
        idleTimeoutMs: int('DATABASE_IDLE_TIMEOUT_MS', 30_000),
        connectionTimeoutMs: int('DATABASE_CONNECTION_TIMEOUT_MS', 10_000)
    },

    marketData: {
        baseUrl: process.env.MARKET_DATA_BASE_URL || 'https://query1.finance.yahoo.com/v8/finance/chart',
        range: process.env.MARKET_DATA_RANGE || '1y',
        interval: process.env.MARKET_DATA_INTERVAL || '1d',
        // Daily closes only change once a day; a 15 minute TTL collapses the
        // request storm from a dashboard refresh into a single upstream call.
        cacheTtlMs: int('MARKET_DATA_CACHE_TTL_MS', 15 * 60 * 1000),
        cacheMaxEntries: int('MARKET_DATA_CACHE_MAX', 256),
        requestTimeoutMs: int('MARKET_DATA_TIMEOUT_MS', 8_000),
        maxRetries: int('MARKET_DATA_MAX_RETRIES', 2),
        retryBaseDelayMs: int('MARKET_DATA_RETRY_BASE_MS', 250)
    },

    portfolio: {
        maxAssets: int('PORTFOLIO_MAX_ASSETS', 12),
        // Floating point weights entered in a UI rarely sum to exactly 1.
        weightSumTolerance: Number(process.env.PORTFOLIO_WEIGHT_TOLERANCE || 0.001),
        tradingDaysPerYear: int('PORTFOLIO_TRADING_DAYS', 252),
        riskFreeRate: Number(process.env.PORTFOLIO_RISK_FREE_RATE || 0.04)
    },

    options: {
        maxSteps: int('OPTIONS_MAX_STEPS', 5_000)
    },

    rateLimit: {
        windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
        maxRequests: int('RATE_LIMIT_MAX', 60)
    },

    cors: {
        // Comma-separated allow-list. Empty means "reflect any origin", which is
        // acceptable for a public read-only demo but is logged as a warning.
        allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
            .split(',')
            .map(o => o.trim())
            .filter(Boolean)
    }
};

module.exports = config;
