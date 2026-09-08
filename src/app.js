'use strict';

const express = require('express');
const cors = require('cors');

const config = require('./config');
const { requestId, accessLog, securityHeaders } = require('./middleware/requestContext');
const { createRateLimiter } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { createPortfolioRouter } = require('./routes/portfolio');
const { createOptionsRouter } = require('./routes/options');
const { createHealthRouter } = require('./routes/health');
const { PortfolioService } = require('./services/portfolioService');

/**
 * Build the Express application.
 *
 * A factory, not a module-level singleton: importing this file opens no sockets,
 * touches no database and starts no listener, so tests can construct an app with
 * injected dependencies and the same code path runs in production.
 */
function createApp({ portfolioService = new PortfolioService(), rateLimiter } = {}) {
    const app = express();

    // Render, Vercel and every other PaaS front the app with a proxy. Without
    // this, req.ip is the load balancer address and the rate limiter would
    // bucket the entire internet together.
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    app.use(requestId);
    if (!config.isTest) app.use(accessLog);
    app.use(securityHeaders);
    app.use(cors(corsOptions()));

    // A body limit prevents a large payload from being buffered into memory
    // before any handler has a chance to reject it.
    app.use(express.json({ limit: '64kb' }));

    const limiter = rateLimiter || createRateLimiter(config.rateLimit);

    // Health checks are deliberately outside the limiter: a platform probing
    // liveness must never be throttled into looking unhealthy.
    app.use('/', createHealthRouter({ portfolioService }));

    // Mounted once, ahead of both routers. Attaching it to each `app.use('/api', ...)`
    // instead would charge two tokens for any request that falls through the
    // first router to the second.
    app.use('/api', limiter);
    app.use('/api', createPortfolioRouter({ portfolioService }));
    app.use('/api', createOptionsRouter());

    app.use(notFoundHandler);
    app.use(errorHandler);

    // Exposed so a graceful shutdown can clear the limiter sweep interval.
    app.locals.rateLimiter = limiter;
    app.locals.portfolioService = portfolioService;

    return app;
}

/**
 * CORS policy.
 *
 * An explicit allow-list when CORS_ALLOWED_ORIGINS is set; otherwise open, which
 * is acceptable only because every endpoint is either a pure computation or a
 * public read. Anything authenticated would require the allow-list to be
 * mandatory, since a wildcard origin plus credentials is a standing CSRF hole.
 */
function corsOptions() {
    const { allowedOrigins } = config.cors;

    if (allowedOrigins.length === 0) {
        if (config.isProduction) {
            console.warn('[cors] No CORS_ALLOWED_ORIGINS set - all origins permitted.');
        }
        return { origin: true };
    }

    return {
        origin(origin, callback) {
            // A missing Origin means a same-origin or non-browser client (curl,
            // a server-to-server call), which CORS does not govern.
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Origin not permitted by CORS policy'));
        },
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        maxAge: 86_400
    };
}

module.exports = { createApp };
