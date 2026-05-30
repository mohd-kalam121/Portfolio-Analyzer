require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = 3000;

// --- DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false }
});

// Automatically create our table when the server starts!
pool.connect()
    .then((client) => {
        console.log('✅ Connected to Cloud PostgreSQL!');
        return client.query(`
            CREATE TABLE IF NOT EXISTS saved_portfolios (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                assets TEXT[],
                weights FLOAT[],
                expected_return VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `).then(() => {
            console.log('✅ Database table ready!');
            client.release();
        });
    })
    .catch(err => console.error('❌ Database connection error:', err.stack));

app.use(cors());
app.use(express.json());

// --- QUANTITATIVE MATH HELPERS ---
function calculateDailyReturns(prices) {
    let returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
}

function calculateMean(data) {
    return data.reduce((sum, val) => sum + val, 0) / data.length;
}

function calculateCovariance(returnsA, returnsB) {
    const meanA = calculateMean(returnsA);
    const meanB = calculateMean(returnsB);
    let cov = 0;
    for (let i = 0; i < returnsA.length; i++) {
        cov += (returnsA[i] - meanA) * (returnsB[i] - meanB);
    }
    return cov / (returnsA.length - 1);
}

// --- NATIVE YAHOO FINANCE API WRAPPER ---
async function fetchHistoricalPrices(ticker) {
    // Hits the raw Yahoo Finance API for 1 year of daily data
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' } // Bypasses basic bot protection
    });
    
    if (!response.ok) throw new Error(`Failed to fetch ${ticker}`);
    
    const data = await response.json();
    const result = data.chart.result[0];
    const closePrices = result.indicators.quote[0].close;
    
    // Clean the data by filtering out any null days (trading halts)
    return closePrices.filter(price => price !== null);
}

// --- REAL-WORLD PORTFOLIO ROUTE ---
app.post('/api/portfolio', async (req, res) => {
    const { assets, weights } = req.body;

    // Strict constraint validation
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 1.0) > 0.001) {
        return res.status(400).json({ status: "error", message: "Weights must sum to 1.0." });
    }

    try {
        // Fetch data simultaneously using your custom API wrapper
        const [pricesA, pricesB] = await Promise.all([
            fetchHistoricalPrices(assets[0]),
            fetchHistoricalPrices(assets[1])
        ]);

        // Ensure array lengths match before matrix math
        const minLength = Math.min(pricesA.length, pricesB.length);
        const returnsA = calculateDailyReturns(pricesA.slice(-minLength));
        const returnsB = calculateDailyReturns(pricesB.slice(-minLength));

        // Calculate Annualized Returns (Assuming 252 trading days)
        const expectedReturnA = calculateMean(returnsA) * 252;
        const expectedReturnB = calculateMean(returnsB) * 252;
        
        const portfolioReturn = (weights[0] * expectedReturnA) + (weights[1] * expectedReturnB);

        // Calculate Covariance and Portfolio Variance (Risk)
        const varA = calculateCovariance(returnsA, returnsA) * 252;
        const varB = calculateCovariance(returnsB, returnsB) * 252;
        const covAB = calculateCovariance(returnsA, returnsB) * 252;

        // Markowitz Variance Formula
        const portfolioVariance = 
            Math.pow(weights[0], 2) * varA + 
            Math.pow(weights[1], 2) * varB + 
            (2 * weights[0] * weights[1] * covAB);
            
        const portfolioVolatility = Math.sqrt(portfolioVariance);

        res.json({
            status: "success",
            message: "Calculated using Custom Yahoo API Wrapper",
            assets: assets,
            weights: weights,
            expected_portfolio_return: (portfolioReturn * 100).toFixed(2) + "%",
            portfolio_volatility: (portfolioVolatility * 100).toFixed(2) + "%"
        });

    } catch (error) {
        console.error("Custom API Error:", error);
        res.status(500).json({ status: "error", message: "Failed to fetch live market data. Check ticker symbols." });
    }
});

// --- POSTGRESQL SAVING ROUTES ---
app.post('/api/save', async (req, res) => {
    try {
        const { name, assets, weights, expected_portfolio_return } = req.body;
        
        await pool.query(
            'INSERT INTO saved_portfolios (name, assets, weights, expected_return) VALUES ($1, $2, $3, $4)',
            [name, assets, weights, expected_portfolio_return]
        );
        
        res.json({ status: "success", message: "Portfolio permanently saved to database!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "error", message: "Failed to save to database." });
    }
});

app.get('/api/portfolios', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM saved_portfolios ORDER BY created_at DESC'
        );
        res.json({ status: "success", data: result.rows });
    } catch (error) {
        console.error("Database fetch error:", error);
        res.status(500).json({ status: "error", message: "Failed to fetch saved portfolios." });
    }
});

// --- POST: CALCULATE CRR BINOMIAL OPTION PRICE ---
app.post('/api/options/crr', (req, res) => {
    try {
        const { S, K, T, r, sigma, N, optionType } = req.body;

        // Basic validation
        if (!S || !K || !T || !sigma || !N) {
            return res.status(400).json({ error: "Missing required parameters." });
        }

        const dt = T / N;
        const u = Math.exp(sigma * Math.sqrt(dt));
        const d = Math.exp(-sigma * Math.sqrt(dt));
        const p = (Math.exp(r * dt) - d) / (u - d);
        const discountFactor = Math.exp(-r * dt);

        // Initialize array for terminal payoffs
        let values = new Array(N + 1);

        for (let i = 0; i <= N; i++) {
            // Price at node (N, i) where i is the number of 'up' moves
            const ST = S * Math.pow(u, i) * Math.pow(d, N - i);
            values[i] = optionType === 'call' ? Math.max(ST - K, 0) : Math.max(K - ST, 0);
        }

        // Step backwards through the tree
        for (let step = N - 1; step >= 0; step--) {
            for (let i = 0; i <= step; i++) {
                // Expected discounted value
                const expectedValue = discountFactor * (p * values[i + 1] + (1 - p) * values[i]);
                values[i] = expectedValue;
            }
        }

        res.json({
            status: "success",
            present_value: values[0].toFixed(4),
            parameters: { S, K, T, r, sigma, N, optionType }
        });

    } catch (error) {
        console.error("CRR Error:", error);
        res.status(500).json({ error: "Internal server error during option calculation." });
    }
});

// --- STARTUP ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});