'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Attach a correlation id to every request and echo it back.
 *
 * The id appears in the access log line, in any error log, and in the JSON error
 * body, so a user reporting "it failed" can quote one value that locates the
 * exact request in the logs.
 */
function requestId(req, res, next) {
    req.id = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', req.id);
    next();
}

/** Single-line structured access log, written when the response finishes. */
function accessLog(req, res, next) {
    const started = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        console.log(JSON.stringify({
            level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            requestId: req.id,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Number(durationMs.toFixed(2))
        }));
    });

    next();
}

/**
 * Baseline security response headers.
 *
 * Hand-rolled rather than pulling in Helmet: this is a JSON API, so only a
 * handful of headers are meaningful and each one is worth being able to justify.
 */
function securityHeaders(req, res, next) {
    // Never let a browser second-guess the declared content type.
    res.set('X-Content-Type-Options', 'nosniff');
    // This API returns no HTML, so no document should ever frame it.
    res.set('X-Frame-Options', 'DENY');
    // Do not leak the API path to third parties via the Referer header.
    res.set('Referrer-Policy', 'no-referrer');
    // A JSON API needs no browser features.
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Do not advertise the framework version to scanners.
    res.removeHeader('X-Powered-By');
    next();
}

module.exports = { requestId, accessLog, securityHeaders };
