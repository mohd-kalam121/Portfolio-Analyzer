'use strict';

const express = require('express');

const db = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');

const startedAt = Date.now();

/**
 * Operational endpoints.
 *
 * Two distinct checks, because they answer different questions:
 *
 *   /health  - is this process alive? Cheap, no dependencies. A platform uses
 *              it for liveness and must not restart the app because Postgres
 *              is briefly unreachable.
 *   /ready   - can this process serve traffic? Checks dependencies, and returns
 *              503 when they are down so a load balancer stops routing to it.
 */
function createHealthRouter({ portfolioService } = {}) {
    const router = express.Router();

    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            timestamp: new Date().toISOString()
        });
    });

    router.get('/ready', asyncHandler(async (req, res) => {
        const database = await db.healthCheck();
        // "not_configured" is a deliberate deployment choice, not a fault.
        const healthy = database.status === 'up' || database.status === 'not_configured';

        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'ready' : 'degraded',
            dependencies: { database },
            // Cache hit rate is the single most useful number for explaining
            // latency on this service, so it is surfaced rather than buried.
            marketDataCache: portfolioService?.marketData?.stats?.() ?? null
        });
    }));

    return router;
}

module.exports = { createHealthRouter };
