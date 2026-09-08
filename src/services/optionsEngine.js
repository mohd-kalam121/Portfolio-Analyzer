'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Cox-Ross-Rubinstein binomial option pricing, plus a closed-form
 * Black-Scholes reference used to validate convergence.
 *
 * The lattice is collapsed into a single array of length N+1 that is overwritten
 * in place during backward induction, so memory is O(N) rather than the O(N^2)
 * of a materialised triangular tree. At N = 5000 that is roughly 40 KB instead
 * of 100 MB.
 */

const MIN_STEPS = 1;

/**
 * @param {object} params
 * @param {number} params.S      Spot price.
 * @param {number} params.K      Strike price.
 * @param {number} params.T      Time to expiry in years.
 * @param {number} params.r      Continuously compounded risk-free rate.
 * @param {number} params.sigma  Annualised volatility.
 * @param {number} params.N      Number of tree steps.
 * @param {'call'|'put'} params.optionType
 * @param {'european'|'american'} [params.exerciseStyle='european']
 */
function priceCRR(params) {
    const { S, K, T, r, sigma, N, optionType, exerciseStyle = 'european' } = validateInputs(params);

    const dt = T / N;
    const u = Math.exp(sigma * Math.sqrt(dt));
    const d = 1 / u;
    const growth = Math.exp(r * dt);
    const p = (growth - d) / (u - d);
    const discount = Math.exp(-r * dt);

    // Outside [0,1] the "risk-neutral probability" is not a probability and the
    // model admits arbitrage. This happens when the step is too coarse for the
    // rate relative to volatility, and silently returning a price would be worse
    // than refusing.
    if (!(p > 0 && p < 1)) {
        throw new ValidationError(
            'No arbitrage-free risk-neutral probability exists for these parameters. ' +
            'Increase the number of steps (N) or check that volatility is consistent with the rate.'
        );
    }

    const isCall = optionType === 'call';
    const isAmerican = exerciseStyle === 'american';

    // Terminal payoffs. Index i counts up-moves, so S_T = S * u^i * d^(N-i).
    const values = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
        const terminalPrice = S * Math.pow(u, 2 * i - N);
        values[i] = isCall
            ? Math.max(terminalPrice - K, 0)
            : Math.max(K - terminalPrice, 0);
    }

    // Node values retained for the Greeks (see deriveGreeks).
    let level2 = null;
    let level1 = null;

    for (let step = N - 1; step >= 0; step--) {
        for (let i = 0; i <= step; i++) {
            let value = discount * (p * values[i + 1] + (1 - p) * values[i]);

            if (isAmerican) {
                // The whole point of a lattice: compare continuation value
                // against immediate exercise at every node.
                const spotAtNode = S * Math.pow(u, 2 * i - step);
                const intrinsic = isCall
                    ? Math.max(spotAtNode - K, 0)
                    : Math.max(K - spotAtNode, 0);
                if (intrinsic > value) value = intrinsic;
            }
            values[i] = value;
        }
        if (step === 2) level2 = [values[0], values[1], values[2]];
        if (step === 1) level1 = [values[0], values[1]];
    }

    const greeks = deriveGreeks({ S, u, d, dt, level1, level2, rootValue: values[0] });

    return {
        presentValue: values[0],
        parameters: { S, K, T, r, sigma, N, optionType, exerciseStyle },
        model: {
            upFactor: u,
            downFactor: d,
            riskNeutralProbability: p,
            stepSize: dt
        },
        greeks
    };
}

/**
 * Delta and gamma read directly off the lattice by finite difference.
 *
 * Free, because the required node values are already computed during backward
 * induction - no need to re-price at bumped spots.
 */
function deriveGreeks({ S, u, d, dt, level1, level2, rootValue }) {
    const greeks = { delta: null, gamma: null, theta: null };

    if (level1) {
        const spotUp = S * u;
        const spotDown = S * d;
        greeks.delta = (level1[1] - level1[0]) / (spotUp - spotDown);
    }

    if (level2) {
        const spotUp = S * u * u;
        const spotMid = S;   // u*d = 1 in the CRR lattice, so the middle node is spot.
        const spotDown = S * d * d;

        const deltaUp = (level2[2] - level2[1]) / (spotUp - spotMid);
        const deltaDown = (level2[1] - level2[0]) / (spotMid - spotDown);
        greeks.gamma = (deltaUp - deltaDown) / (0.5 * (spotUp - spotDown));

        // Theta per year. The middle node two steps in sits at the same spot as
        // the root, so the difference between them isolates the passage of
        // 2*dt of time. It must be compared against the root value, not against
        // a step-1 node, which is at a different spot entirely.
        greeks.theta = (level2[1] - rootValue) / (2 * dt);
    }

    return greeks;
}

/**
 * Black-Scholes closed form for a European option.
 *
 * Present for two reasons: it gives an instant answer where the lattice is not
 * needed, and it is the reference the CRR tests assert convergence against -
 * the binomial price must approach this value as N grows.
 */
function priceBlackScholes({ S, K, T, r, sigma, optionType }) {
    if (T <= 0 || sigma <= 0) {
        const intrinsic = optionType === 'call'
            ? Math.max(S - K, 0)
            : Math.max(K - S, 0);
        return { presentValue: intrinsic };
    }

    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const discountedStrike = K * Math.exp(-r * T);

    const presentValue = optionType === 'call'
        ? S * normalCdf(d1) - discountedStrike * normalCdf(d2)
        : discountedStrike * normalCdf(-d2) - S * normalCdf(-d1);

    return {
        presentValue,
        d1,
        d2,
        greeks: {
            delta: optionType === 'call' ? normalCdf(d1) : normalCdf(d1) - 1,
            gamma: normalPdf(d1) / (S * sigma * sqrtT),
            vega: S * normalPdf(d1) * sqrtT,
            // Theta per year (negative for a long option: time decay).
            theta: optionType === 'call'
                ? -(S * normalPdf(d1) * sigma) / (2 * sqrtT) - r * discountedStrike * normalCdf(d2)
                : -(S * normalPdf(d1) * sigma) / (2 * sqrtT) + r * discountedStrike * normalCdf(-d2)
        }
    };
}

/**
 * Standard normal CDF, using the Hart (1968) rational approximation.
 *
 * Accurate to roughly double-precision machine epsilon, against about 1e-7 for
 * the commonly used Abramowitz-Stegun 7.1.26 polynomial. That precision is the
 * point: this function is the analytic reference the binomial tests assert
 * convergence against, so its own error must be far smaller than the
 * discretisation error being measured.
 */
function normalCdf(x) {
    const z = Math.abs(x);
    let upperTail;

    if (z > 37) {
        // Beyond 37 standard deviations the tail underflows double precision.
        upperTail = 0;
    } else {
        const e = Math.exp(-z * z / 2);

        if (z < 7.071067811865475) {
            // Rational approximation on the central region.
            let numerator = 3.52624965998911e-02 * z + 0.700383064443688;
            numerator = numerator * z + 6.37396220353165;
            numerator = numerator * z + 33.912866078383;
            numerator = numerator * z + 112.079291497871;
            numerator = numerator * z + 221.213596169931;
            numerator = numerator * z + 220.206867912376;

            let denominator = 8.83883476483184e-02 * z + 1.75566716318264;
            denominator = denominator * z + 16.064177579207;
            denominator = denominator * z + 86.7807322029461;
            denominator = denominator * z + 296.564248779674;
            denominator = denominator * z + 637.333633378831;
            denominator = denominator * z + 793.826512519948;
            denominator = denominator * z + 440.413735824752;

            upperTail = e * numerator / denominator;
        } else {
            // Continued-fraction expansion in the far tail, where the rational
            // form above loses relative accuracy.
            let f = z + 0.65;
            f = z + 4 / f;
            f = z + 3 / f;
            f = z + 2 / f;
            f = z + 1 / f;
            upperTail = e / (f * 2.506628274631);
        }
    }

    return x > 0 ? 1 - upperTail : upperTail;
}

function normalPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function validateInputs(params) {
    const { S, K, T, r, sigma, N, optionType, exerciseStyle = 'european' } = params || {};

    const numeric = { S, K, T, r, sigma, N };
    for (const [name, value] of Object.entries(numeric)) {
        if (value === undefined || value === null || value === '') {
            throw new ValidationError(`Missing required parameter: ${name}`);
        }
        if (!Number.isFinite(Number(value))) {
            throw new ValidationError(`Parameter ${name} must be a finite number`);
        }
    }

    const parsed = {
        S: Number(S), K: Number(K), T: Number(T),
        r: Number(r), sigma: Number(sigma), N: Math.trunc(Number(N)),
        optionType, exerciseStyle
    };

    if (parsed.S <= 0) throw new ValidationError('Spot price (S) must be greater than zero');
    if (parsed.K <= 0) throw new ValidationError('Strike price (K) must be greater than zero');
    if (parsed.T <= 0) throw new ValidationError('Time to expiry (T) must be greater than zero');
    if (parsed.sigma <= 0) throw new ValidationError('Volatility (sigma) must be greater than zero');
    if (parsed.N < MIN_STEPS) throw new ValidationError(`Steps (N) must be at least ${MIN_STEPS}`);

    if (!['call', 'put'].includes(parsed.optionType)) {
        throw new ValidationError('optionType must be either "call" or "put"');
    }
    if (!['european', 'american'].includes(parsed.exerciseStyle)) {
        throw new ValidationError('exerciseStyle must be either "european" or "american"');
    }

    return parsed;
}

module.exports = { priceCRR, priceBlackScholes, normalCdf, normalPdf, validateInputs };
