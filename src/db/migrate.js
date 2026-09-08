'use strict';

const { query } = require('./pool');

/**
 * Forward-only, idempotent schema migrations.
 *
 * Each migration is guarded so running the full list against an existing
 * database is a no-op. That keeps deployment to a single step (the server
 * migrates on boot) while remaining safe to re-run, which matters on a platform
 * that may start several instances or restart on a cold start.
 */
const MIGRATIONS = [
    {
        name: '001_create_saved_portfolios',
        sql: `
            CREATE TABLE IF NOT EXISTS saved_portfolios (
                id             SERIAL PRIMARY KEY,
                name           VARCHAR(100) NOT NULL,
                assets         TEXT[]       NOT NULL,
                weights        DOUBLE PRECISION[] NOT NULL,
                created_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `
    },
    {
        name: '002_add_risk_metric_columns',
        sql: `
            ALTER TABLE saved_portfolios
                ADD COLUMN IF NOT EXISTS expected_return   DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS annual_volatility DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS sharpe_ratio      DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS value_at_risk     DOUBLE PRECISION
        `
    },
    {
        name: '003_convert_expected_return_to_numeric',
        /*
         * The original API stored a pre-formatted percentage string - literally
         * '58.20%', and '-27.16%' for a loss - in a VARCHAR column. Metrics are
         * now stored as numeric fractions and formatted at the presentation
         * layer, so existing rows have to be both re-typed and re-scaled.
         *
         * A bare `ALTER COLUMN ... TYPE DOUBLE PRECISION` fails outright here,
         * because '58.20%' has no numeric cast. The conversion therefore strips
         * every non-numeric character (keeping the sign, decimal point and any
         * exponent) and divides by 100 to turn a percentage into a fraction.
         *
         * The whole thing is branched on the column's current type so that
         * re-running it against an already-migrated database does nothing -
         * without that guard, a second run would divide by 100 again and
         * silently corrupt every stored figure.
         */
        sql: `
            DO $$
            DECLARE
                current_type TEXT;
            BEGIN
                SELECT data_type INTO current_type
                FROM information_schema.columns
                WHERE table_name = 'saved_portfolios'
                  AND column_name = 'expected_return';

                IF current_type IN ('character varying', 'character', 'text') THEN
                    ALTER TABLE saved_portfolios
                        ALTER COLUMN expected_return TYPE DOUBLE PRECISION
                        USING NULLIF(regexp_replace(expected_return, '[^0-9eE.+-]', '', 'g'), '')::DOUBLE PRECISION / 100.0;

                ELSIF current_type = 'real' THEN
                    -- Already numeric, only narrower than intended.
                    ALTER TABLE saved_portfolios
                        ALTER COLUMN expected_return TYPE DOUBLE PRECISION;
                END IF;
            END $$;
        `
    },
    {
        name: '004_convert_created_at_to_timestamptz',
        /*
         * A `timestamp without time zone` records an instant with no way to know
         * what instant it was. The existing values were written by
         * CURRENT_TIMESTAMP on a UTC host, so they are interpreted as UTC.
         */
        sql: `
            DO $$
            DECLARE
                current_type TEXT;
            BEGIN
                SELECT data_type INTO current_type
                FROM information_schema.columns
                WHERE table_name = 'saved_portfolios'
                  AND column_name = 'created_at';

                IF current_type = 'timestamp without time zone' THEN
                    ALTER TABLE saved_portfolios
                        ALTER COLUMN created_at TYPE TIMESTAMPTZ
                        USING created_at AT TIME ZONE 'UTC';
                END IF;
            END $$;
        `
    },
    {
        name: '005_index_created_at',
        // The listing endpoint always orders by created_at DESC; without this
        // index every read is a sequential scan plus a sort.
        sql: `
            CREATE INDEX IF NOT EXISTS idx_saved_portfolios_created_at
                ON saved_portfolios (created_at DESC)
        `
    }
];

async function runMigrations() {
    const applied = [];
    for (const migration of MIGRATIONS) {
        try {
            await query(migration.sql);
            applied.push(migration.name);
        } catch (error) {
            // Name the migration that failed. Without this the boot log shows a
            // bare Postgres error with no indication of which statement raised it.
            error.message = `migration ${migration.name} failed: ${error.message}`;
            throw error;
        }
    }
    return applied;
}

module.exports = { runMigrations, MIGRATIONS };
