# QuantTerminal 📈

A full-stack quantitative financial modeling dashboard designed to calculate optimal asset allocation, compute portfolio volatility using live market data, and price European options using dynamic programming.

## 🚀 Architecture & Tech Stack
* **Frontend:** React (Vite), Tailwind CSS v4, Recharts, Lucide Icons
* **Backend:** Node.js, Express.js
* **Database:** Cloud PostgreSQL (Neon/Supabase)
* **Data Pipeline:** Custom Native Fetch API (Bypassing third-party dependency bottlenecks to connect directly to Yahoo Finance servers).

## 🧠 Core Quantitative Engines

### 1. Modern Portfolio Theory (Markowitz Optimization)
Calculates the expected return and risk (volatility) of a two-asset portfolio using live, 1-year historical closing prices.
* **Dynamic Data Syncing:** Automatically normalizes trading day arrays to prevent matrix misalignments due to market halts.
* **Covariance Matrix:** Computes annualized variance and covariance to execute the standard Markowitz volatility formula.

### 2. Cox-Ross-Rubinstein (CRR) Binomial Options Pricing
Prices European Call and Put options using a discrete-time binomial tree model.
* Calculates risk-neutral probabilities ($p$) and discount factors.
* Steps backward through a dynamic $N$-step terminal payoff array to calculate the fair theoretical present value.

## ⚙️ Local Development Setup

**1. Clone the repository**
\`\`\`bash
git clone https://github.com/mohd-kalam121/Portfolio-Analyzer.git
cd Portfolio-Analyzer
\`\`\`

**2. Setup the Backend Environment**
Create a `.env` file in the root directory and add your PostgreSQL connection string:
\`\`\`env
DATABASE_URL=your_postgres_connection_string_here
\`\`\`

**3. Install Dependencies & Run**
Open two terminal windows:

*Terminal 1 (Backend Engine):*
\`\`\`bash
npm install
node index.js
\`\`\`

*Terminal 2 (Frontend UI):*
\`\`\`bash
cd client
npm install
npm run dev
\`\`\`