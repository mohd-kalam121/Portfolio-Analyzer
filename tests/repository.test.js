'use strict';

process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRepository, MAX_PAGE_SIZE } = require('../src/db/portfolioRepository');

/**
 * The repository is exercised against a recording stub rather than a live
 * database. What is being asserted is the contract this layer is responsible
 * for: that every value is passed as a bound parameter, that paging inputs are
 * clamped, and that rows are unwrapped consistently.
 */
function stubQuery(result = { rows: [], rowCount: 0 }) {
    const calls = [];
    const query = async (text, params) => {
        calls.push({ text, params });
        return typeof result === 'function' ? result(text, params) : result;
    };
    query.calls = calls;
    return query;
}

test('save binds every value as a parameter, never inlining it into SQL', async () => {
    const query = stubQuery({ rows: [{ id: 1 }], rowCount: 1 });
    const repo = createRepository({ query });

    await repo.save({
        name: "Robert'); DROP TABLE saved_portfolios;--",
        assets: ['AAPL', 'MSFT'],
        weights: [0.6, 0.4],
        expectedReturn: 0.12,
        annualVolatility: 0.2,
        sharpeRatio: 0.4,
        valueAtRisk: 0.02
    });

    const { text, params } = query.calls[0];
    assert.match(text, /INSERT INTO saved_portfolios/);
    // The hostile name must appear only in the parameter array.
    assert.ok(!text.includes('DROP TABLE'), 'user input must not reach the statement text');
    assert.equal(params[0], "Robert'); DROP TABLE saved_portfolios;--");
    assert.deepEqual(params[1], ['AAPL', 'MSFT']);
    assert.deepEqual(params[2], [0.6, 0.4]);
    assert.equal(params.length, 7);
});

test('save returns the inserted row', async () => {
    const row = { id: 7, name: 'Growth' };
    const repo = createRepository({ query: stubQuery({ rows: [row], rowCount: 1 }) });
    assert.deepEqual(await repo.save({ assets: [], weights: [] }), row);
});

test('list orders newest first and pages with bound parameters', async () => {
    const query = stubQuery({ rows: [{ id: 2 }, { id: 1 }], rowCount: 2 });
    const repo = createRepository({ query });

    const rows = await repo.list({ limit: 10, offset: 20 });

    assert.match(query.calls[0].text, /ORDER BY created_at DESC/);
    assert.deepEqual(query.calls[0].params, [10, 20]);
    assert.equal(rows.length, 2);
});

test('list clamps an oversized or nonsensical page size', async () => {
    const query = stubQuery();
    const repo = createRepository({ query });

    await repo.list({ limit: 100000, offset: -5 });
    assert.deepEqual(query.calls[0].params, [MAX_PAGE_SIZE, 0]);

    await repo.list({ limit: 'all', offset: 'none' });
    assert.deepEqual(query.calls[1].params, [50, 0]);

    await repo.list();
    assert.deepEqual(query.calls[2].params, [50, 0]);
});

test('findById returns null rather than undefined when nothing matches', async () => {
    const repo = createRepository({ query: stubQuery({ rows: [], rowCount: 0 }) });
    assert.equal(await repo.findById(99), null);
});

test('findById returns the single matching row', async () => {
    const repo = createRepository({ query: stubQuery({ rows: [{ id: 3 }], rowCount: 1 }) });
    assert.deepEqual(await repo.findById(3), { id: 3 });
});

test('remove reports whether a row was actually deleted', async () => {
    const deleted = createRepository({ query: stubQuery({ rows: [{ id: 1 }], rowCount: 1 }) });
    assert.equal(await deleted.remove(1), true);

    const missing = createRepository({ query: stubQuery({ rows: [], rowCount: 0 }) });
    assert.equal(await missing.remove(1), false);
});

test('count unwraps the aggregate as a number', async () => {
    const repo = createRepository({ query: stubQuery({ rows: [{ total: 42 }], rowCount: 1 }) });
    assert.equal(await repo.count(), 42);
});

test('a driver failure propagates rather than being swallowed', async () => {
    const repo = createRepository({
        query: async () => { throw new Error('connection terminated unexpectedly'); }
    });
    await assert.rejects(() => repo.count(), /connection terminated/);
});
