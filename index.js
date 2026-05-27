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

// --- MOCK MARKET DATA PROVIDER ---
function fetchMockMarketData(ticker) {
    const realisticReturns = {
        'AAPL': 0.22, 'MSFT': 0.18, 'TSLA': 0.35, 'NVDA': 0.85, 'GOOG': 0.14
    };
    return realisticReturns[ticker.toUpperCase()] || (Math.random() * 0.10 + 0.05);
}

// --- API ROUTES ---
app.post('/api/portfolio', (req, res) => {
    const userAssets = req.body.assets;
    const userWeights = req.body.weights;

    const totalWeight = userWeights.reduce((sum, w) => sum + w, 0);
    
    if (Math.abs(totalWeight - 1.0) > 0.001) {
        return res.status(400).json({
            status: "error",
            message: `Constraint Failed: Portfolio weights must sum to exactly 1.0.`
        });
    }

    try {
        let expectedReturns = [];
        for (let i = 0; i < userAssets.length; i++) {
            expectedReturns.push(fetchMockMarketData(userAssets[i]));
        }
        
        let portfolioReturn = 0;
        for (let i = 0; i < userWeights.length; i++) {
            portfolioReturn += userWeights[i] * expectedReturns[i];
        }

        res.json({
            status: "success",
            message: "Calculated successfully using internal market data!",
            assets: userAssets,
            weights: userWeights,
            expected_portfolio_return: (portfolioReturn * 100).toFixed(2) + "%"
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "error", message: "Failed to process data." });
    }
});

// NEW ROUTE: Save data to PostgreSQL
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


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});