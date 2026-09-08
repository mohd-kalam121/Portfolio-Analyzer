'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePortfolioRequest, validateSaveRequest } = require('../src/services/portfolioValidator');

test('a well-formed request is normalised to uppercase tickers and numeric weights', () => {
    const result = validatePortfolioRequest({ assets: ['aapl', ' msft '], weights: ['0.6', 0.4] });
    assert.deepEqual(result.assets, ['AAPL', 'MSFT']);
    assert.deepEqual(result.weights, [0.6, 0.4]);
});

test('weights within tolerance of 1.0 are accepted', () => {
    // A UI producing 0.3333 three times cannot sum to exactly 1.
    const result = validatePortfolioRequest({
        assets: ['A', 'B', 'C'],
        weights: [0.3333, 0.3333, 0.3334]
    });
    assert.equal(result.weights.length, 3);
});

test('weights that do not sum to 1.0 are rejected with the actual sum', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'MSFT'], weights: [0.6, 0.6] }),
        (err) => err.message.includes('1.2000') && err.details.providedSum === 1.2
    );
});

test('negative weights are rejected rather than silently priced as shorts', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'MSFT'], weights: [1.5, -0.5] }),
        /Short positions are not supported/
    );
});

test('non-numeric weights are rejected by position', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'MSFT'], weights: [0.5, 'half'] }),
        /position 1 is not a finite number/
    );
});

test('duplicate tickers are rejected because they make the covariance singular', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'aapl'], weights: [0.5, 0.5] }),
        /Duplicate assets.*AAPL/
    );
});

test('a portfolio needs at least two assets to have a covariance structure', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL'], weights: [1] }),
        /at least two assets/
    );
});

test('mismatched array lengths report both lengths', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'MSFT'], weights: [1] }),
        /received 2 and 1/
    );
});

test('non-array inputs are rejected', () => {
    assert.throws(() => validatePortfolioRequest({ assets: 'AAPL', weights: [1] }), /must be arrays/);
    assert.throws(() => validatePortfolioRequest(null), /must be arrays/);
    assert.throws(() => validatePortfolioRequest({}), /must be arrays/);
});

test('an oversized portfolio is rejected before any market data is fetched', () => {
    const assets = Array.from({ length: 50 }, (_, i) => `T${i}`);
    const weights = assets.map(() => 1 / assets.length);
    assert.throws(() => validatePortfolioRequest({ assets, weights }), /maximum of/);
});

test('an invalid ticker is named in the error', () => {
    assert.throws(
        () => validatePortfolioRequest({ assets: ['AAPL', 'not a ticker'], weights: [0.5, 0.5] }),
        /not a valid ticker symbol/
    );
});

test('save requires a non-empty name and trims it', () => {
    const result = validateSaveRequest({
        name: '  Growth Sleeve  ', assets: ['AAPL', 'MSFT'], weights: [0.5, 0.5]
    });
    assert.equal(result.name, 'Growth Sleeve');
});

test('save rejects a blank or overlong name', () => {
    const valid = { assets: ['AAPL', 'MSFT'], weights: [0.5, 0.5] };
    assert.throws(() => validateSaveRequest({ ...valid, name: '   ' }), /name is required/);
    assert.throws(() => validateSaveRequest({ ...valid }), /name is required/);
    assert.throws(() => validateSaveRequest({ ...valid, name: 'x'.repeat(101) }), /100 characters/);
});

test('save also enforces every portfolio rule', () => {
    assert.throws(
        () => validateSaveRequest({ name: 'Bad', assets: ['AAPL', 'MSFT'], weights: [0.9, 0.9] }),
        /must sum to 1.0/
    );
});
