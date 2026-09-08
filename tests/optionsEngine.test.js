'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { priceCRR, priceBlackScholes, normalCdf } = require('../src/services/optionsEngine');

const closeTo = (actual, expected, tolerance) =>
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );

const BASE = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, optionType: 'call' };

test('Black-Scholes reproduces the textbook benchmark price', () => {
    // Hull, Options Futures and Other Derivatives: S=K=100, r=5%, sigma=20%, T=1
    // gives a European call worth 10.4506.
    closeTo(priceBlackScholes(BASE).presentValue, 10.450584, 1e-4);
});

test('normalCdf matches known standard normal values to near machine precision', () => {
    // Exact values, not the rounded textbook figures: Phi(1.96) is 0.97500210...,
    // not 0.975 - that is Phi(1.95996398...).
    closeTo(normalCdf(0), 0.5, 1e-15);
    closeTo(normalCdf(1), 0.8413447460685429, 1e-14);
    closeTo(normalCdf(1.96), 0.9750021048517795, 1e-14);
    closeTo(normalCdf(-1.96), 0.024997895148220435, 1e-14);
    closeTo(normalCdf(2.5), 0.9937903346742238, 1e-14);
});

test('normalCdf is symmetric and saturates in the tails', () => {
    for (const x of [0.25, 1, 2.5, 6, 10]) {
        closeTo(normalCdf(x) + normalCdf(-x), 1, 1e-14);
    }
    assert.equal(normalCdf(40), 1);
    assert.equal(normalCdf(-40), 0);
});

test('normalCdf inverts the risk engine quantile function', () => {
    // Round-trip property across two independently derived approximations:
    // agreement is strong evidence that neither is wrong.
    const { normalQuantile } = require('../src/services/riskEngine');
    for (const p of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
        closeTo(normalCdf(normalQuantile(p)), p, 1e-9);
    }
});

test('CRR converges to Black-Scholes as the step count increases', () => {
    const analytic = priceBlackScholes(BASE).presentValue;

    const errorAt = (N) => Math.abs(priceCRR({ ...BASE, N }).presentValue - analytic);

    const coarse = errorAt(50);
    const fine = errorAt(500);
    const finest = errorAt(2000);

    assert.ok(fine < coarse, 'error must shrink as N grows');
    assert.ok(finest < fine, 'error must keep shrinking as N grows');
    // The binomial model converges at O(1/N), so 2000 steps should be within
    // a cent of the analytic price.
    assert.ok(finest < 0.01, `expected sub-cent accuracy at N=2000, got ${finest}`);
});

test('CRR satisfies put-call parity: C - P = S - K*exp(-rT)', () => {
    const call = priceCRR({ ...BASE, optionType: 'call', N: 1000 }).presentValue;
    const put = priceCRR({ ...BASE, optionType: 'put', N: 1000 }).presentValue;
    const parity = BASE.S - BASE.K * Math.exp(-BASE.r * BASE.T);

    closeTo(call - put, parity, 1e-6);
});

test('an American put is worth at least its European counterpart', () => {
    const european = priceCRR({ ...BASE, optionType: 'put', N: 500 }).presentValue;
    const american = priceCRR({ ...BASE, optionType: 'put', N: 500, exerciseStyle: 'american' }).presentValue;

    assert.ok(american >= european, 'early exercise cannot reduce value');
    assert.ok(american > european, 'a non-dividend put should carry an early exercise premium');
});

test('an American call on a non-dividend stock equals the European price', () => {
    // Standard result: early exercise of a call on a non-dividend-paying stock
    // is never optimal, so the two prices coincide.
    const european = priceCRR({ ...BASE, N: 500 }).presentValue;
    const american = priceCRR({ ...BASE, N: 500, exerciseStyle: 'american' }).presentValue;
    closeTo(american, european, 1e-9);
});

test('option value is bounded by its intrinsic value and the spot price', () => {
    const deepItm = priceCRR({ ...BASE, K: 50, N: 500 }).presentValue;
    assert.ok(deepItm >= 100 - 50 * Math.exp(-0.05), 'must exceed discounted intrinsic value');
    assert.ok(deepItm <= 100, 'a call can never be worth more than the underlying');
});

test('a deep out-of-the-money call approaches zero', () => {
    const value = priceCRR({ ...BASE, K: 1000, N: 200 }).presentValue;
    assert.ok(value >= 0);
    assert.ok(value < 0.01, `expected a near-zero price, got ${value}`);
});

test('option value increases monotonically with volatility (positive vega)', () => {
    const low = priceCRR({ ...BASE, sigma: 0.1, N: 300 }).presentValue;
    const mid = priceCRR({ ...BASE, sigma: 0.3, N: 300 }).presentValue;
    const high = priceCRR({ ...BASE, sigma: 0.5, N: 300 }).presentValue;

    assert.ok(low < mid && mid < high, 'call value must rise with volatility');
});

test('call value decreases monotonically with strike', () => {
    const values = [80, 100, 120].map(K => priceCRR({ ...BASE, K, N: 300 }).presentValue);
    assert.ok(values[0] > values[1] && values[1] > values[2]);
});

test('lattice Greeks agree with the Black-Scholes closed form', () => {
    const analytic = priceBlackScholes(BASE).greeks;
    const lattice = priceCRR({ ...BASE, N: 1000 }).greeks;

    closeTo(lattice.delta, analytic.delta, 1e-3);
    closeTo(lattice.gamma, analytic.gamma, 1e-3);
    closeTo(lattice.theta, analytic.theta, 1e-2);
});

test('theta is negative for a long option, reflecting time decay', () => {
    const call = priceCRR({ ...BASE, N: 500 }).greeks.theta;
    const put = priceCRR({ ...BASE, optionType: 'put', N: 500 }).greeks.theta;

    assert.ok(call < 0, `a long call must decay, got theta ${call}`);
    assert.ok(put < 0, `this put must decay at these parameters, got theta ${put}`);
    // Benchmark value for the standard parameter set.
    closeTo(call, -6.414, 0.05);
});

test('delta is bounded by the no-arbitrage limits for each option type', () => {
    const call = priceCRR({ ...BASE, N: 300 }).greeks.delta;
    const put = priceCRR({ ...BASE, optionType: 'put', N: 300 }).greeks.delta;

    assert.ok(call > 0 && call < 1, `call delta must lie in (0,1), got ${call}`);
    assert.ok(put > -1 && put < 0, `put delta must lie in (-1,0), got ${put}`);
});

test('gamma is positive for a long option', () => {
    assert.ok(priceCRR({ ...BASE, N: 300 }).greeks.gamma > 0);
    assert.ok(priceCRR({ ...BASE, optionType: 'put', N: 300 }).greeks.gamma > 0);
});

test('CRR reports the model parameters it used', () => {
    const result = priceCRR({ ...BASE, N: 100 });
    const { upFactor, downFactor, riskNeutralProbability } = result.model;

    // The CRR construction requires u*d = 1.
    closeTo(upFactor * downFactor, 1, 1e-12);
    assert.ok(riskNeutralProbability > 0 && riskNeutralProbability < 1);
});

test('parameters producing an arbitrage are rejected rather than priced', () => {
    // A very high rate with tiny volatility and one step pushes the risk-neutral
    // probability outside [0,1].
    assert.throws(
        () => priceCRR({ S: 100, K: 100, T: 1, r: 5, sigma: 0.01, N: 1, optionType: 'call' }),
        /arbitrage-free/
    );
});

test('input validation rejects non-positive and missing parameters', () => {
    assert.throws(() => priceCRR({ ...BASE, S: 0, N: 10 }), /Spot price/);
    assert.throws(() => priceCRR({ ...BASE, K: -5, N: 10 }), /Strike price/);
    assert.throws(() => priceCRR({ ...BASE, T: 0, N: 10 }), /Time to expiry/);
    assert.throws(() => priceCRR({ ...BASE, sigma: 0, N: 10 }), /Volatility/);
    assert.throws(() => priceCRR({ ...BASE, N: 0 }), /at least/);
    assert.throws(() => priceCRR({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, optionType: 'call' }), /Missing required parameter: N/);
    assert.throws(() => priceCRR({ ...BASE, N: 10, optionType: 'straddle' }), /call.*put/);
    assert.throws(() => priceCRR({ ...BASE, N: 10, exerciseStyle: 'bermudan' }), /european.*american/);
    assert.throws(() => priceCRR({ ...BASE, N: 10, S: 'abc' }), /finite number/);
});

test('a single-step tree prices correctly by hand', () => {
    // One step, u = e^(0.2), d = e^(-0.2), r = 0.
    const result = priceCRR({ S: 100, K: 100, T: 1, r: 0, sigma: 0.2, N: 1, optionType: 'call' });

    const u = Math.exp(0.2);
    const d = Math.exp(-0.2);
    const p = (1 - d) / (u - d);
    const expected = p * Math.max(100 * u - 100, 0);

    closeTo(result.presentValue, expected, 1e-9);
});

test('pricing a large tree stays within a reasonable time budget', () => {
    const started = Date.now();
    priceCRR({ ...BASE, N: 5000 });
    const elapsed = Date.now() - started;
    // O(N^2) over a flat Float64Array: 25M node updates should be well under 2s.
    assert.ok(elapsed < 2000, `expected N=5000 under 2s, took ${elapsed}ms`);
});
