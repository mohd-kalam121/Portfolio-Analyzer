'use strict';

const express = require('express');

const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');
const { priceCRR, priceBlackScholes } = require('../services/optionsEngine');

/** Derivatives pricing routes. */
function createOptionsRouter() {
    const router = express.Router();

    /**
     * POST /api/options/crr - binomial lattice price plus lattice Greeks.
     *
     * The response also carries the Black-Scholes value and the gap between the
     * two, which is the honest way to present a numerical method: it shows the
     * caller how far the discretisation currently is from the analytic limit.
     */
    router.post('/options/crr', asyncHandler(async (req, res) => {
        const steps = Number(req.body?.N);
        // Work is O(N^2); an unbounded N is a trivial CPU exhaustion vector on a
        // single-threaded event loop, so the ceiling is enforced before pricing.
        if (Number.isFinite(steps) && steps > config.options.maxSteps) {
            throw new ValidationError(
                `Steps (N) may not exceed ${config.options.maxSteps}.`,
                { maxSteps: config.options.maxSteps }
            );
        }

        const result = priceCRR(req.body);

        const response = {
            status: 'success',
            presentValue: Number(result.presentValue.toFixed(6)),
            greeks: roundGreeks(result.greeks),
            model: {
                upFactor: Number(result.model.upFactor.toFixed(8)),
                downFactor: Number(result.model.downFactor.toFixed(8)),
                riskNeutralProbability: Number(result.model.riskNeutralProbability.toFixed(8)),
                stepSize: result.model.stepSize
            },
            parameters: result.parameters
        };

        if (result.parameters.exerciseStyle === 'european') {
            const analytic = priceBlackScholes(result.parameters);
            response.reference = {
                model: 'black-scholes',
                presentValue: Number(analytic.presentValue.toFixed(6)),
                absoluteDifference: Number(
                    Math.abs(analytic.presentValue - result.presentValue).toFixed(8)
                )
            };
        }

        res.json(response);
    }));

    /** POST /api/options/black-scholes - closed-form European price and Greeks. */
    router.post('/options/black-scholes', asyncHandler(async (req, res) => {
        const { S, K, T, r, sigma, optionType } = req.body || {};
        if (!['call', 'put'].includes(optionType)) {
            throw new ValidationError('optionType must be either "call" or "put"');
        }
        for (const [name, value] of Object.entries({ S, K, T, r, sigma })) {
            if (!Number.isFinite(Number(value))) {
                throw new ValidationError(`Parameter ${name} must be a finite number`);
            }
        }

        const result = priceBlackScholes({
            S: Number(S), K: Number(K), T: Number(T),
            r: Number(r), sigma: Number(sigma), optionType
        });

        res.json({
            status: 'success',
            presentValue: Number(result.presentValue.toFixed(6)),
            greeks: roundGreeks(result.greeks),
            parameters: { S, K, T, r, sigma, optionType }
        });
    }));

    return router;
}

function roundGreeks(greeks) {
    if (!greeks) return null;
    return Object.fromEntries(
        Object.entries(greeks).map(([key, value]) => [
            key,
            typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(6)) : null
        ])
    );
}

module.exports = { createOptionsRouter };
