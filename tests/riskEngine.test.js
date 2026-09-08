'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/services/riskEngine');

const closeTo = (actual, expected, tolerance = 1e-9) =>
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );

test('calculateDailyReturns produces n-1 simple returns', () => {
    const returns = engine.calculateDailyReturns([100, 110, 105]);
    assert.equal(returns.length, 2);
    closeTo(returns[0], 0.1);
    closeTo(returns[1], -5 / 110);
});

test('calculateDailyReturns rejects a zero price rather than yielding Infinity', () => {
    assert.throws(() => engine.calculateDailyReturns([100, 0, 50]), /zero or non-finite/);
});

test('calculateDailyReturns returns empty for a series too short to difference', () => {
    assert.deepEqual(engine.calculateDailyReturns([100]), []);
    assert.deepEqual(engine.calculateDailyReturns([]), []);
});

test('calculateCovariance matches a hand-computed sample covariance', () => {
    // Bessel-corrected covariance of these series is 2.5 by hand.
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10];
    // cov = sum((a-3)(b-6)) / 4 = (2*4 + 1*2 + 0 + 1*2 + 2*4) / 4 = 20/4 = 5
    closeTo(engine.calculateCovariance(a, b), 5);
});

test('covariance of a series with itself equals its variance', () => {
    const series = [0.01, -0.02, 0.015, 0.003, -0.007];
    closeTo(engine.calculateCovariance(series, series), engine.calculateVariance(series));
});

test('covariance is symmetric and pre-computed means do not change the result', () => {
    const a = [0.01, -0.02, 0.015, 0.003];
    const b = [0.02, -0.01, 0.005, -0.002];
    const forward = engine.calculateCovariance(a, b);
    closeTo(engine.calculateCovariance(b, a), forward);
    closeTo(
        engine.calculateCovariance(a, b, engine.calculateMean(a), engine.calculateMean(b)),
        forward
    );
});

test('covariance is zero for mismatched or degenerate inputs', () => {
    assert.equal(engine.calculateCovariance([1, 2, 3], [1, 2]), 0);
    assert.equal(engine.calculateCovariance([1], [1]), 0);
});

test('covariance matrix is symmetric with variances on the diagonal', () => {
    const returnsMatrix = [
        [0.01, -0.02, 0.015, 0.004],
        [0.02, -0.01, 0.005, -0.002],
        [-0.005, 0.012, -0.008, 0.011]
    ];
    const matrix = engine.buildCovarianceMatrix(returnsMatrix);

    for (let i = 0; i < 3; i++) {
        closeTo(matrix[i][i], engine.calculateVariance(returnsMatrix[i]));
        for (let j = 0; j < 3; j++) {
            closeTo(matrix[i][j], matrix[j][i]);
        }
    }
});

test('correlation matrix has a unit diagonal and stays within [-1, 1]', () => {
    const returnsMatrix = [
        [0.01, -0.02, 0.015, 0.004],
        [0.02, -0.01, 0.005, -0.002]
    ];
    const correlation = engine.buildCorrelationMatrix(engine.buildCovarianceMatrix(returnsMatrix));

    closeTo(correlation[0][0], 1);
    closeTo(correlation[1][1], 1);
    assert.ok(correlation[0][1] >= -1 && correlation[0][1] <= 1);
    closeTo(correlation[0][1], correlation[1][0]);
});

test('perfectly correlated assets have correlation 1', () => {
    const base = [100, 102, 101, 105, 104];
    const doubled = base.map(p => p * 2);
    const returnsMatrix = [base, doubled].map(engine.calculateDailyReturns);
    const correlation = engine.buildCorrelationMatrix(engine.buildCovarianceMatrix(returnsMatrix));
    closeTo(correlation[0][1], 1, 1e-12);
});

test('portfolioVariance matches the explicit double summation', () => {
    const covariance = [
        [0.04, 0.006, 0.002],
        [0.006, 0.09, 0.004],
        [0.002, 0.004, 0.16]
    ];
    const weights = [0.5, 0.3, 0.2];

    // Reference implementation: the naive full n^2 sum the optimised version replaces.
    let expected = 0;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) expected += weights[i] * weights[j] * covariance[i][j];
    }

    closeTo(engine.portfolioVariance(weights, covariance), expected, 1e-15);
});

test('a fully concentrated portfolio has the variance of its single holding', () => {
    const covariance = [[0.04, 0.01], [0.01, 0.09]];
    closeTo(engine.portfolioVariance([1, 0], covariance), 0.04);
    closeTo(engine.portfolioVariance([0, 1], covariance), 0.09);
});

test('diversification lowers variance below the weighted average of components', () => {
    // Two equally risky, uncorrelated assets: variance halves at equal weights.
    const covariance = [[0.04, 0], [0, 0.04]];
    closeTo(engine.portfolioVariance([0.5, 0.5], covariance), 0.02);
});

test('normalQuantile reproduces published standard normal z-values', () => {
    closeTo(engine.normalQuantile(0.95), 1.6448536269514722, 1e-8);
    closeTo(engine.normalQuantile(0.99), 2.3263478740408408, 1e-8);
    closeTo(engine.normalQuantile(0.975), 1.9599639845400545, 1e-8);
    closeTo(engine.normalQuantile(0.5), 0, 1e-9);
});

test('normalQuantile is antisymmetric about the median', () => {
    closeTo(engine.normalQuantile(0.05), -engine.normalQuantile(0.95), 1e-8);
});

test('normalQuantile rejects probabilities outside the open unit interval', () => {
    assert.throws(() => engine.normalQuantile(0), /strictly between/);
    assert.throws(() => engine.normalQuantile(1), /strictly between/);
});

test('maxDrawdown finds the largest peak-to-trough decline', () => {
    // Peak 120, trough 60 => 50% drawdown.
    closeTo(engine.maxDrawdown([100, 120, 90, 60, 110]), 0.5);
    // A monotonically rising series never draws down.
    closeTo(engine.maxDrawdown([100, 101, 102, 103]), 0);
});

test('alignSeries truncates to the shortest series, keeping the newest points', () => {
    const aligned = engine.alignSeries([[1, 2, 3, 4, 5], [10, 20, 30]]);
    assert.deepEqual(aligned[0], [3, 4, 5]);
    assert.deepEqual(aligned[1], [10, 20, 30]);
});

test('alignSeries refuses an overlap too small to compute a return', () => {
    assert.throws(() => engine.alignSeries([[1, 2, 3], [5]]), /Not enough overlapping/);
});

test('analysePortfolio risk contributions sum to one (Euler decomposition)', () => {
    const prices = [
        [100, 102, 101, 104, 103, 106, 108, 107, 110, 109],
        [50, 49, 51, 50.5, 52, 51, 53, 54, 53.5, 55],
        [200, 198, 202, 205, 203, 207, 206, 210, 208, 212]
    ];
    const weights = [0.5, 0.3, 0.2];
    const analysis = engine.analysePortfolio(['A', 'B', 'C'], weights, prices);

    const total = analysis.breakdown.reduce((sum, asset) => sum + asset.riskContribution, 0);
    closeTo(total, 1, 1e-9);
});

test('analysePortfolio expected return is the weighted sum of asset returns', () => {
    const prices = [
        [100, 102, 104, 103, 106, 108],
        [50, 51, 50, 52, 53, 52]
    ];
    const weights = [0.7, 0.3];
    const analysis = engine.analysePortfolio(['A', 'B'], weights, prices);

    const reconstructed = analysis.breakdown.reduce(
        (sum, asset) => sum + asset.weight * asset.annualReturn, 0);
    closeTo(analysis.expectedAnnualReturn, reconstructed, 1e-12);
});

test('analysePortfolio volatility is the square root of its variance', () => {
    const prices = [
        [100, 102, 104, 103, 106, 108],
        [50, 51, 50, 52, 53, 52]
    ];
    const analysis = engine.analysePortfolio(['A', 'B'], [0.5, 0.5], prices);
    closeTo(analysis.annualVolatility, Math.sqrt(analysis.annualVariance), 1e-12);
});

test('analysePortfolio reports a diversification ratio of 1 for a single effective holding', () => {
    const prices = [
        [100, 102, 104, 103, 106, 108],
        [50, 51, 52, 51.5, 53, 54]
    ];
    // All weight on one asset: no diversification benefit is available.
    const analysis = engine.analysePortfolio(['A', 'B'], [1, 0], prices);
    closeTo(analysis.diversificationRatio, 1, 1e-9);
});

test('analysePortfolio aligns series of unequal length before computing', () => {
    const prices = [
        [100, 102, 104, 103, 106, 108],
        [50, 51, 50, 52, 53]
    ];
    const analysis = engine.analysePortfolio(['A', 'B'], [0.5, 0.5], prices);
    // Shortest series has 5 closes => 4 returns after alignment.
    assert.equal(analysis.observations, 4);
});

test('parametricVaR is non-negative and grows with confidence', () => {
    const low = engine.parametricVaR(0.10, 0.20, 0.95, 252);
    const high = engine.parametricVaR(0.10, 0.20, 0.99, 252);
    assert.ok(low >= 0);
    assert.ok(high > low, 'a higher confidence level must imply a larger loss threshold');
});

test('parametricVaR floors at zero when drift dominates volatility', () => {
    const value = engine.parametricVaR(10, 0.0001, 0.95, 252);
    assert.equal(value, 0);
});
