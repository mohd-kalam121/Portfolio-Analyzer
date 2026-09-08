'use strict';

/**
 * Process entry point.
 *
 * The application itself lives under `src/`. This file stays only so that a
 * deployment configured with `node index.js` as its start command keeps working
 * across the restructure.
 */
const { start } = require('./src/server');

start().catch((error) => {
    console.error('[fatal] failed to start server:', error);
    process.exit(1);
});
