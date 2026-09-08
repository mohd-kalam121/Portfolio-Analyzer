'use strict';

const config = require('./config');
const db = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { createApp } = require('./app');

/**
 * Process entry point: migrate, listen, and shut down cleanly.
 */
async function start() {
    const app = createApp();

    if (db.isConfigured()) {
        try {
            const applied = await runMigrations();
            console.log(`[db] schema ready (${applied.length} migrations checked)`);
        } catch (error) {
            // Refuse to serve against an unknown schema. Starting anyway would
            // mean every persistence request fails at runtime with a confusing
            // error instead of one clear failure at boot.
            console.error('[db] migration failed:', error.message);
            process.exit(1);
        }
    } else {
        console.warn('[db] DATABASE_URL not set - persistence endpoints will return 503.');
    }

    const server = app.listen(config.port, () => {
        // Report the bound port, not the requested one: with PORT=0 the OS picks
        // an ephemeral port and the configured value says nothing useful.
        console.log(`[server] listening on port ${server.address().port} (${config.env})`);
    });

    // A cold-start platform will hold a request open behind a slow upstream;
    // this bounds how long a socket can sit idle before the platform gives up.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    registerShutdownHandlers(server, app);
    return server;
}

/**
 * Drain in-flight requests before exiting.
 *
 * Without this, a deploy or autoscale event severs live connections mid-request
 * and leaks the Postgres pool. The timer is a backstop for a connection that
 * never finishes closing.
 */
function registerShutdownHandlers(server, app) {
    let shuttingDown = false;

    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[server] ${signal} received, draining connections...`);

        const forceExit = setTimeout(() => {
            console.error('[server] graceful shutdown timed out, forcing exit');
            process.exit(1);
        }, 10_000);
        forceExit.unref();

        server.close(async () => {
            try {
                app.locals.rateLimiter?.stop?.();
                await db.close();
                console.log('[server] shutdown complete');
                process.exit(0);
            } catch (error) {
                console.error('[server] error during shutdown:', error.message);
                process.exit(1);
            }
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // A crash with an unknown state is not recoverable in-process; log loudly
    // and let the platform restart with a clean one.
    process.on('unhandledRejection', (reason) => {
        console.error('[fatal] unhandled promise rejection:', reason);
        shutdown('unhandledRejection');
    });
    process.on('uncaughtException', (error) => {
        console.error('[fatal] uncaught exception:', error);
        shutdown('uncaughtException');
    });
}

module.exports = { start };

if (require.main === module) {
    start().catch((error) => {
        console.error('[fatal] failed to start server:', error);
        process.exit(1);
    });
}
