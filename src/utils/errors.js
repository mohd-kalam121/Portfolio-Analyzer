'use strict';

/**
 * Errors we raise deliberately and are happy to show a client.
 *
 * The distinction matters: `AppError` carries a message written for a caller,
 * while anything else that reaches the error handler is treated as an internal
 * fault and reported as a generic 500 so stack traces, driver messages and
 * upstream URLs never leave the process.
 */
class AppError extends Error {
    constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = undefined) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.expose = true;
        Error.captureStackTrace(this, AppError);
    }
}

class ValidationError extends AppError {
    constructor(message, details) {
        super(message, 400, 'VALIDATION_ERROR', details);
        this.name = 'ValidationError';
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

/** An upstream dependency (market data feed) failed or was unavailable. */
class UpstreamError extends AppError {
    constructor(message, code = 'UPSTREAM_UNAVAILABLE') {
        super(message, 502, code);
        this.name = 'UpstreamError';
    }
}

class RateLimitError extends AppError {
    constructor(retryAfterSeconds) {
        super('Rate limit exceeded. Please retry shortly.', 429, 'RATE_LIMITED');
        this.name = 'RateLimitError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

module.exports = { AppError, ValidationError, NotFoundError, UpstreamError, RateLimitError };
