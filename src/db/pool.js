'use strict';

const { Pool } = require('pg');
const config = require('../config');

/**
 * Shared Postgres connection pool.
 *
 * Created lazily so that importing the application (in tests, or in a tool that
 * only needs the pricing engines) does not open sockets or require a
 * DATABASE_URL to be present.
 */

let pool = null;

function getPool() {
    if (pool) return pool;

    if (!config.database.connectionString) {
        throw new Error('DATABASE_URL is not configured');
    }

    pool = new Pool({
        connectionString: config.database.connectionString,
        ssl: config.database.ssl,
        max: config.database.poolMax,
        idleTimeoutMillis: config.database.idleTimeoutMs,
        connectionTimeoutMillis: config.database.connectionTimeoutMs
    });

    // An idle client erroring (network blip, provider restart) emits on the pool.
    // Without a listener this is an unhandled error event and takes the process
    // down; pg discards the broken client and reconnects on the next checkout.
    pool.on('error', (err) => {
        console.error('[db] idle client error', err.message);
    });

    return pool;
}

function isConfigured() {
    return Boolean(config.database.connectionString);
}

async function query(text, params) {
    const started = Date.now();
    const result = await getPool().query(text, params);
    const duration = Date.now() - started;

    // Slow-query visibility without pulling in an APM dependency.
    if (duration > 500) {
        console.warn(`[db] slow query ${duration}ms: ${text.split('\n')[0].trim()}`);
    }
    return result;
}

async function healthCheck() {
    if (!isConfigured()) return { status: 'not_configured' };
    try {
        const started = Date.now();
        await getPool().query('SELECT 1');
        return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
        return { status: 'down', error: error.message };
    }
}

async function close() {
    if (!pool) return;
    await pool.end();
    pool = null;
}

module.exports = { getPool, query, healthCheck, close, isConfigured };
