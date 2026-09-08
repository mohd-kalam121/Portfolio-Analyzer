'use strict';

const config = require('../config');
const riskEngine = require('./riskEngine');
const { MarketDataService } = require('./marketData');

/**
 * Orchestrates a portfolio analysis: market data in, risk analytics out.
 *
 * The market data client is injected rather than imported so tests can drive the
 * whole path with a stub and no network, and so a different provider can be
 * swapped in without touching the maths.
 */
class PortfolioService {
    constructor({ marketData } = {}) {
        this.marketData = marketData || new MarketDataService();
    }

    async analyse({ assets, weights }) {
        const priceSeries = await this.marketData.getHistoricalPricesBatch(assets);

        return riskEngine.analysePortfolio(assets, weights, priceSeries, {
            tradingDays: config.portfolio.tradingDaysPerYear,
            riskFreeRate: config.portfolio.riskFreeRate
        });
    }
}

/**
 * Shape the analysis for the wire.
 *
 * Numbers stay numbers. The original API returned strings like "12.34%", which
 * forces every consumer to parse presentation back into data and makes the
 * values unusable for charting, sorting or storage. Percentages are provided
 * alongside as a rounded convenience, never as a replacement.
 */
function toResponse(analysis) {
    const round = (value, dp = 6) => Number(value.toFixed(dp));
    const pct = (value) => Number((value * 100).toFixed(2));

    return {
        status: 'success',
        assets: analysis.assets,
        weights: analysis.weights,
        observations: analysis.observations,
        metrics: {
            expectedAnnualReturn: round(analysis.expectedAnnualReturn),
            annualVolatility: round(analysis.annualVolatility),
            sharpeRatio: round(analysis.sharpeRatio, 4),
            diversificationRatio: round(analysis.diversificationRatio, 4),
            riskFreeRate: analysis.riskFreeRate,
            valueAtRisk: {
                confidence: analysis.valueAtRisk.confidence,
                horizon: analysis.valueAtRisk.horizon,
                fraction: round(analysis.valueAtRisk.fraction),
                percent: pct(analysis.valueAtRisk.fraction)
            }
        },
        formatted: {
            expectedAnnualReturn: `${pct(analysis.expectedAnnualReturn)}%`,
            annualVolatility: `${pct(analysis.annualVolatility)}%`,
            valueAtRisk: `${pct(analysis.valueAtRisk.fraction)}%`
        },
        breakdown: analysis.breakdown.map(asset => ({
            ticker: asset.ticker,
            weight: asset.weight,
            annualReturn: round(asset.annualReturn),
            annualVolatility: round(asset.annualVolatility),
            maxDrawdown: round(asset.maxDrawdown),
            riskContribution: round(asset.riskContribution, 4)
        })),
        correlationMatrix: analysis.correlationMatrix.map(row =>
            row.map(value => Number(value.toFixed(4)))
        ),

        // --- DEPRECATED: remove once the new client is live ---------------
        // The API and the browser client deploy independently, so for a few
        // minutes during a rollout the previous client is talking to this
        // version. These are the two fields it reads; emitting them keeps that
        // window seamless (expand now, contract later) rather than blanking the
        // headline figure on the live page. Safe to delete in a follow-up
        // commit once the new client has shipped.
        expected_portfolio_return: `${pct(analysis.expectedAnnualReturn)}%`,
        message: 'Calculated from live market data'
    };
}

module.exports = { PortfolioService, toResponse };
