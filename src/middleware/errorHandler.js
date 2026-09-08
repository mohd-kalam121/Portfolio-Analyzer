'use strict';

const config = require('../config');
const { AppError, NotFoundError } = require('../utils/errors');

/**
 * Wrap an async route handler so a rejected promise reaches Express.
 *
 * Express 5 forwards rejections automatically, but wrapping explicitly keeps the
 * intent visible and means the handlers behave identically if the app is ever
 * mounted under Express 4.
 */
const asyncHandler = (handler) => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

/** Terminal 404 for unmatched routes. */
function notFoundHandler(req, res, next) {
    next(new NotFoundError(`No route matches ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler.
 *
 * The rule: only an `AppError` - an error this code raised on purpose - is
 * described to the client. Anything else is logged in full server-side and
 * answered with a generic 500. Driver messages, file paths, upstream URLs and
 * stack traces are exactly the details an attacker wants, and they leak easily
 * when handlers respond with a raw `error.message`.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies the error handler by arity.
function errorHandler(err, req, res, next) {
    const isExpected = err instanceof AppError && err.expose;
    const statusCode = isExpected ? err.statusCode : 500;

    if (!isExpected) {
        console.error(`[error] ${req.method} ${req.originalUrl}`, {
            requestId: req.id,
            message: err.message,
            stack: err.stack
        });
    } else if (statusCode >= 500) {
        console.warn(`[upstream] ${req.method} ${req.originalUrl} - ${err.message}`);
    }

    if (err.retryAfterSeconds) {
        res.set('Retry-After', String(err.retryAfterSeconds));
    }

    const body = {
        status: 'error',
        code: isExpected ? err.code : 'INTERNAL_ERROR',
        message: isExpected ? err.message : 'An unexpected error occurred.',
        requestId: req.id
    };

    if (isExpected && err.details) body.details = err.details;

    // Stack traces are a development affordance only, never sent in production.
    if (!config.isProduction && !isExpected) body.debug = err.message;

    res.status(statusCode).json(body);
}

module.exports = { asyncHandler, notFoundHandler, errorHandler };
