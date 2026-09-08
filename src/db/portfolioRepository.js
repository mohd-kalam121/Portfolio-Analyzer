'use strict';

const pool = require('./pool');

/**
 * Data access for saved portfolios.
 *
 * All SQL lives here rather than in route handlers, so the HTTP layer never
 * touches the driver and the query surface can be reviewed in one place. Every
 * statement is parameterised - values travel separately from the statement text,
 * so a ticker or portfolio name can never be interpreted as SQL.
 *
 * Built as a factory over an injected `query` function so the statements and
 * their argument marshalling are testable without a live database.
 */

const COLUMNS = `
    id, name, assets, weights, expected_return, annual_volatility,
    sharpe_ratio, value_at_risk, created_at
`;

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function createRepository({ query }) {
    return {
        async save(portfolio) {
            const {
                name, assets, weights, expectedReturn,
                annualVolatility, sharpeRatio, valueAtRisk
            } = portfolio;

            const result = await query(
                `INSERT INTO saved_portfolios
                    (name, assets, weights, expected_return, annual_volatility, sharpe_ratio, value_at_risk)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING ${COLUMNS}`,
                [name, assets, weights, expectedReturn, annualVolatility, sharpeRatio, valueAtRisk]
            );
            return result.rows[0];
        },

        /** Newest first. The page size is clamped so one caller cannot ask for the whole table. */
        async list({ limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
            const safeLimit = clampInt(limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
            const safeOffset = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0);

            const result = await query(
                `SELECT ${COLUMNS}
                 FROM saved_portfolios
                 ORDER BY created_at DESC
                 LIMIT $1 OFFSET $2`,
                [safeLimit, safeOffset]
            );
            return result.rows;
        },

        async findById(id) {
            const result = await query(
                `SELECT ${COLUMNS} FROM saved_portfolios WHERE id = $1`,
                [id]
            );
            return result.rows[0] || null;
        },

        async remove(id) {
            const result = await query(
                'DELETE FROM saved_portfolios WHERE id = $1 RETURNING id',
                [id]
            );
            return result.rowCount > 0;
        },

        async count() {
            const result = await query('SELECT COUNT(*)::int AS total FROM saved_portfolios');
            return result.rows[0].total;
        }
    };
}

/** Coerce a caller-supplied paging value into a safe integer within bounds. */
function clampInt(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
}

// Default instance, bound to the shared pool, used by the routes.
const repository = createRepository({ query: (text, params) => pool.query(text, params) });

module.exports = { ...repository, createRepository, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
