'use strict';

const express = require('express');

const { asyncHandler } = require('../middleware/errorHandler');
const { PortfolioService, toResponse } = require('../services/portfolioService');
const { validatePortfolioRequest, validateSaveRequest } = require('../services/portfolioValidator');
const { NotFoundError, ValidationError, AppError } = require('../utils/errors');
const repository = require('../db/portfolioRepository');
const db = require('../db/pool');

/**
 * Portfolio analytics and persistence routes.
 *
 * Handlers stay thin on purpose: validate, delegate, serialise. The maths lives
 * in the risk engine, the SQL in the repository, and the error shaping in the
 * central handler, so each of those can be tested without an HTTP server.
 */
function createPortfolioRouter({ portfolioService = new PortfolioService() } = {}) {
    const router = express.Router();

    /** POST /api/portfolio - risk analytics for a candidate allocation. */
    router.post('/portfolio', asyncHandler(async (req, res) => {
        const { assets, weights } = validatePortfolioRequest(req.body);
        const analysis = await portfolioService.analyse({ assets, weights });
        res.json(toResponse(analysis));
    }));

    /**
     * POST /api/save - analyse and persist in one call.
     *
     * Deliberately not "trust the metrics the client sends". The previous design
     * stored whatever number the browser posted, so the saved record was
     * unverifiable and trivially forged. Recomputing server-side means a stored
     * row always corresponds to its stated allocation.
     */
    router.post('/save', requireDatabase, asyncHandler(async (req, res) => {
        const { name, assets, weights } = validateSaveRequest(req.body);
        const analysis = await portfolioService.analyse({ assets, weights });

        const saved = await repository.save({
            name,
            assets,
            weights,
            expectedReturn: analysis.expectedAnnualReturn,
            annualVolatility: analysis.annualVolatility,
            sharpeRatio: analysis.sharpeRatio,
            valueAtRisk: analysis.valueAtRisk.fraction
        });

        res.status(201).json({
            status: 'success',
            message: 'Portfolio saved.',
            data: saved,
            analysis: toResponse(analysis)
        });
    }));

    /** GET /api/portfolios - paginated listing, newest first. */
    router.get('/portfolios', requireDatabase, asyncHandler(async (req, res) => {
        const limit = req.query.limit ?? 50;
        const offset = req.query.offset ?? 0;

        const [rows, total] = await Promise.all([
            repository.list({ limit, offset }),
            repository.count()
        ]);

        res.json({
            status: 'success',
            data: rows,
            pagination: { total, limit: Number(limit), offset: Number(offset) }
        });
    }));

    router.get('/portfolios/:id', requireDatabase, asyncHandler(async (req, res) => {
        const id = parsePositiveInt(req.params.id, 'id');
        const row = await repository.findById(id);
        if (!row) throw new NotFoundError(`No saved portfolio with id ${id}`);
        res.json({ status: 'success', data: row });
    }));

    router.delete('/portfolios/:id', requireDatabase, asyncHandler(async (req, res) => {
        const id = parsePositiveInt(req.params.id, 'id');
        const deleted = await repository.remove(id);
        if (!deleted) throw new NotFoundError(`No saved portfolio with id ${id}`);
        res.status(204).send();
    }));

    return router;
}

/**
 * Guard the persistence routes when no database is configured.
 *
 * Without this the pricing engines would be unusable in any environment that has
 * not provisioned Postgres, because the pool constructor throws on import.
 * 503 is the honest answer: the route exists but its dependency does not.
 */
function requireDatabase(req, res, next) {
    if (!db.isConfigured()) {
        return next(new AppError(
            'Persistence is not available in this environment.',
            503,
            'DATABASE_UNAVAILABLE'
        ));
    }
    return next();
}

function parsePositiveInt(raw, field) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`"${field}" must be a positive integer.`);
    }
    return value;
}

module.exports = { createPortfolioRouter };
