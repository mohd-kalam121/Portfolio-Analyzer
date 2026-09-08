'use strict';

const config = require('../config');
const { ValidationError } = require('../utils/errors');
const { MarketDataService } = require('./marketData');

/**
 * Validation and normalisation of a portfolio request.
 *
 * Kept separate from the route so the rules are testable without HTTP, and so
 * the handler reads as orchestration rather than a wall of guard clauses.
 * Every rule returns a message a caller can act on, naming the offending field.
 */
function validatePortfolioRequest(body) {
    const { assets, weights } = body || {};

    if (!Array.isArray(assets) || !Array.isArray(weights)) {
        throw new ValidationError('Both "assets" and "weights" must be arrays.');
    }
    if (assets.length !== weights.length) {
        throw new ValidationError(
            `"assets" and "weights" must be the same length (received ${assets.length} and ${weights.length}).`
        );
    }
    if (assets.length < 2) {
        throw new ValidationError('A portfolio requires at least two assets to have a covariance structure.');
    }
    if (assets.length > config.portfolio.maxAssets) {
        throw new ValidationError(
            `A maximum of ${config.portfolio.maxAssets} assets is supported (received ${assets.length}).`
        );
    }

    // Throws with the offending symbol named.
    const normalisedAssets = assets.map(a => MarketDataService.normaliseTicker(a));

    const duplicates = findDuplicates(normalisedAssets);
    if (duplicates.length > 0) {
        // A repeated ticker makes the covariance matrix singular and the risk
        // contributions meaningless; the caller means to combine the weights.
        throw new ValidationError(`Duplicate assets are not allowed: ${duplicates.join(', ')}.`);
    }

    const numericWeights = weights.map((w, i) => {
        const value = Number(w);
        if (!Number.isFinite(value)) {
            throw new ValidationError(`Weight at position ${i} is not a finite number.`);
        }
        // Short positions are a legitimate portfolio construct, but the risk
        // reporting here (and the pie chart consuming it) assumes long-only.
        if (value < 0) {
            throw new ValidationError(
                `Weight at position ${i} is negative. Short positions are not supported.`
            );
        }
        return value;
    });

    const total = numericWeights.reduce((sum, w) => sum + w, 0);
    if (Math.abs(total - 1) > config.portfolio.weightSumTolerance) {
        throw new ValidationError(
            `Weights must sum to 1.0 (received ${total.toFixed(4)}).`,
            { providedSum: Number(total.toFixed(6)), tolerance: config.portfolio.weightSumTolerance }
        );
    }

    return { assets: normalisedAssets, weights: numericWeights };
}

function validateSaveRequest(body) {
    const { name } = body || {};

    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new ValidationError('A portfolio name is required.');
    }
    const trimmed = name.trim();
    if (trimmed.length > 100) {
        throw new ValidationError('Portfolio name must be 100 characters or fewer.');
    }

    const { assets, weights } = validatePortfolioRequest(body);
    return { name: trimmed, assets, weights };
}

function findDuplicates(values) {
    const seen = new Set();
    const duplicates = new Set();
    for (const value of values) {
        if (seen.has(value)) duplicates.add(value);
        seen.add(value);
    }
    return [...duplicates];
}

module.exports = { validatePortfolioRequest, validateSaveRequest };
