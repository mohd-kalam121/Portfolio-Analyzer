'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Pure portfolio-risk mathematics - no I/O, no framework, no configuration
 * beyond explicit arguments. Everything here is deterministic and unit tested,
 * which is what allows the covariance and VaR figures to be trusted.
 *
 * Convention: "returns" are simple (arithmetic) daily returns, and annualising
 * uses the standard square-root-of-time rule over `tradingDays` observations.
 */

/** Simple daily returns: r_t = (P_t - P_{t-1}) / P_{t-1}. */
function calculateDailyReturns(prices) {
    if (!Array.isArray(prices) || prices.length < 2) return [];
    const returns = new Array(prices.length - 1);
    for (let i = 1; i < prices.length; i++) {
        const previous = prices[i - 1];
        if (!Number.isFinite(previous) || previous === 0) {
            throw new ValidationError('Price series contains a zero or non-finite value');
        }
        returns[i - 1] = (prices[i] - previous) / previous;
    }
    return returns;
}

function calculateMean(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length;
}

/**
 * Sample covariance with the Bessel correction (n-1 denominator).
 *
 * `meanA`/`meanB` are optional pre-computed means. The covariance matrix builder
 * passes them in so each asset mean is computed once rather than once per
 * matrix cell.
 */
function calculateCovariance(returnsA, returnsB, meanA, meanB) {
    if (!Array.isArray(returnsA) || !Array.isArray(returnsB)) return 0;
    if (returnsA.length !== returnsB.length || returnsA.length < 2) return 0;

    const mA = meanA === undefined ? calculateMean(returnsA) : meanA;
    const mB = meanB === undefined ? calculateMean(returnsB) : meanB;

    let sum = 0;
    for (let i = 0; i < returnsA.length; i++) {
        sum += (returnsA[i] - mA) * (returnsB[i] - mB);
    }
    return sum / (returnsA.length - 1);
}

function calculateVariance(returns) {
    return calculateCovariance(returns, returns);
}

function calculateStdDev(returns) {
    return Math.sqrt(Math.max(calculateVariance(returns), 0));
}

/**
 * Build the full covariance matrix, exploiting symmetry.
 *
 * Cov(i,j) === Cov(j,i), so only the upper triangle is computed and then
 * mirrored: n(n+1)/2 passes over the return series instead of n^2. For a
 * 12-asset portfolio that is 78 passes rather than 144.
 */
function buildCovarianceMatrix(returnsMatrix) {
    const n = returnsMatrix.length;
    const means = returnsMatrix.map(calculateMean);
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            const cov = calculateCovariance(returnsMatrix[i], returnsMatrix[j], means[i], means[j]);
            matrix[i][j] = cov;
            matrix[j][i] = cov;
        }
    }
    return matrix;
}

/** Pearson correlation derived from the covariance matrix: rho = cov / (s_i * s_j). */
function buildCorrelationMatrix(covarianceMatrix) {
    const n = covarianceMatrix.length;
    const stdDevs = covarianceMatrix.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
    return Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => {
            const denominator = stdDevs[i] * stdDevs[j];
            if (denominator === 0) return 0;
            return clamp(covarianceMatrix[i][j] / denominator, -1, 1);
        })
    );
}

/**
 * The quadratic form (w transpose)(Sigma)(w) - portfolio variance under Markowitz.
 *
 * Written as the diagonal terms plus twice the upper triangle, which is the
 * same symmetry trick applied to the summation itself.
 */
function portfolioVariance(weights, covarianceMatrix) {
    let variance = 0;
    for (let i = 0; i < weights.length; i++) {
        variance += weights[i] * weights[i] * covarianceMatrix[i][i];
        for (let j = i + 1; j < weights.length; j++) {
            variance += 2 * weights[i] * weights[j] * covarianceMatrix[i][j];
        }
    }
    return Math.max(variance, 0);
}

/**
 * Largest peak-to-trough decline over the price series, as a positive fraction.
 * Reported because volatility alone understates the experience of holding an
 * asset through a drawdown.
 */
function maxDrawdown(prices) {
    if (!Array.isArray(prices) || prices.length < 2) return 0;
    let peak = prices[0];
    let worst = 0;
    for (let i = 1; i < prices.length; i++) {
        if (prices[i] > peak) peak = prices[i];
        if (peak > 0) {
            const drawdown = (peak - prices[i]) / peak;
            if (drawdown > worst) worst = drawdown;
        }
    }
    return worst;
}

/**
 * Parametric (variance-covariance) Value at Risk.
 *
 * Returns the loss threshold, as a positive fraction of portfolio value, that
 * is not expected to be exceeded over one day at the given confidence - the
 * standard desk-level risk number, assuming normally distributed returns.
 */
function parametricVaR(annualReturn, annualVolatility, confidence, tradingDays) {
    const dailyReturn = annualReturn / tradingDays;
    const dailyVolatility = annualVolatility / Math.sqrt(tradingDays);
    const z = normalQuantile(confidence);
    return Math.max(z * dailyVolatility - dailyReturn, 0);
}

/**
 * Inverse standard normal CDF via the Acklam rational approximation
 * (absolute error below 1.15e-9), so no statistics dependency is required.
 */
function normalQuantile(p) {
    if (!(p > 0 && p < 1)) throw new ValidationError('Confidence must lie strictly between 0 and 1');

    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
        1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
        6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
        -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
        3.754408661907416e+00];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    if (p < pLow) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > pHigh) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Truncate every series to the shortest common length, keeping the most recent
 * observations.
 *
 * This is the load-bearing correctness step of the whole engine: covariance
 * between two series is only meaningful if observation i of each refers to the
 * same trading day. Assets on different exchanges, or with different halt
 * histories, return different numbers of closes, and naively zipping them
 * silently correlates Monday against Tuesday.
 */
function alignSeries(priceArrays) {
    const minLength = Math.min(...priceArrays.map(arr => arr.length));
    if (!Number.isFinite(minLength) || minLength < 2) {
        throw new ValidationError('Not enough overlapping historical data to compute risk metrics');
    }
    return priceArrays.map(arr => arr.slice(-minLength));
}

/**
 * Full Markowitz analytics for an N-asset portfolio.
 *
 * @param {string[]}   assets      Ticker symbols, index-aligned with weights.
 * @param {number[]}   weights     Allocation fractions summing to 1.
 * @param {number[][]} priceArrays Historical closes per asset.
 * @param {object}     options     tradingDays, riskFreeRate, varConfidence.
 */
function analysePortfolio(assets, weights, priceArrays, options = {}) {
    const tradingDays = options.tradingDays || 252;
    const riskFreeRate = options.riskFreeRate ?? 0.04;
    const varConfidence = options.varConfidence ?? 0.95;

    const aligned = alignSeries(priceArrays);
    const returnsMatrix = aligned.map(calculateDailyReturns);

    const covarianceMatrix = buildCovarianceMatrix(returnsMatrix);
    const correlationMatrix = buildCorrelationMatrix(covarianceMatrix);

    const annualisedReturns = returnsMatrix.map(r => calculateMean(r) * tradingDays);
    const annualisedVolatilities = covarianceMatrix.map((row, i) =>
        Math.sqrt(Math.max(row[i], 0) * tradingDays));

    const expectedReturn = weights.reduce((sum, w, i) => sum + w * annualisedReturns[i], 0);
    const variance = portfolioVariance(weights, covarianceMatrix) * tradingDays;
    const volatility = Math.sqrt(variance);

    const sharpeRatio = volatility === 0 ? 0 : (expectedReturn - riskFreeRate) / volatility;

    // Weighted average of standalone volatilities against actual portfolio
    // volatility. A ratio above 1 quantifies the risk removed by diversification.
    const weightedAverageVolatility = weights.reduce(
        (sum, w, i) => sum + Math.abs(w) * annualisedVolatilities[i], 0);
    const diversificationRatio = volatility === 0 ? 0 : weightedAverageVolatility / volatility;

    return {
        assets,
        weights,
        observations: returnsMatrix[0].length,
        expectedAnnualReturn: expectedReturn,
        annualVolatility: volatility,
        annualVariance: variance,
        sharpeRatio,
        diversificationRatio,
        valueAtRisk: {
            confidence: varConfidence,
            horizon: '1d',
            fraction: parametricVaR(expectedReturn, volatility, varConfidence, tradingDays)
        },
        riskFreeRate,
        breakdown: assets.map((ticker, i) => ({
            ticker,
            weight: weights[i],
            annualReturn: annualisedReturns[i],
            annualVolatility: annualisedVolatilities[i],
            maxDrawdown: maxDrawdown(aligned[i]),
            // Marginal contribution to portfolio variance, normalised to a share
            // of total risk: shows which holding actually drives the risk number.
            // These sum to 1 across the portfolio by Euler decomposition.
            riskContribution: variance === 0 ? 0 :
                (weights[i] * covarianceMatrix[i].reduce((s, cov, j) => s + weights[j] * cov, 0) * tradingDays) / variance
        })),
        correlationMatrix
    };
}

module.exports = {
    calculateDailyReturns,
    calculateMean,
    calculateCovariance,
    calculateVariance,
    calculateStdDev,
    buildCovarianceMatrix,
    buildCorrelationMatrix,
    portfolioVariance,
    maxDrawdown,
    parametricVaR,
    normalQuantile,
    alignSeries,
    analysePortfolio
};
