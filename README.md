# 📈 QuantTerminal: Financial Modeling & Risk Analyzer

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

A full-stack, institutional-grade web application designed to calculate expected portfolio returns, compute real-world asset volatility using live market data, and price European options. Built with a focus on a robust REST API, strict quantitative business logic, and a highly responsive modern UI.

**🌐 Live Frontend Demo:** [QuantTerminal on Vercel](https://portfolio-analyzer-three.vercel.app/)  
**⚙️ Live API Endpoint:** [QuantTerminal API on Render](https://portfolio-analyzer-api-9g75.onrender.com/api/portfolios)

*(Note: Live deployments may take 30-50 seconds to spin up from cold starts).*

---

## 🚀 Core Product Features

* **Live Market Data Pipeline:** Bypasses standard third-party dependencies using a custom native `fetch` wrapper to pull 1-year historical daily closing prices directly from Yahoo Finance servers.
* **Markowitz Portfolio Optimization:** Dynamically calculates annualized portfolio variance, covariance, and overall volatility (risk) using the standard Markowitz covariance matrix.
* **CRR Binomial Options Pricing:** Includes a dedicated quantitative engine to price European Call and Put options using a discrete-time binomial tree model and risk-neutral probabilities.
* **Strict Constraint Validation:** Backend API enforces strict business logic, ensuring portfolio weights equal exactly 1.0 (100%) before processing or saving data.
* **Interactive Dashboard UI:** Built with Tailwind CSS v4 and Recharts for a clean, responsive, card-based interface featuring animated loading states and SVG data visualization.
* **Cloud Persistence:** Saves and retrieves portfolio configurations and calculated metrics in real-time from a relational managed cloud database.

---

## 💻 Architecture & Tech Stack

**Frontend (Client)**
* **Framework:** React.js (Vite)
* **Styling:** Tailwind CSS v4
* **Components:** Recharts (Data Visualization), Lucide-React (Icons)
* **Deployment:** Vercel

**Backend (API Engine)**
* **Framework:** Node.js & Express.js
* **Data Integration:** Custom Native HTTP Fetch Pipeline (Yahoo Finance)
* **Architecture:** RESTful API (GET/POST) with strict matrix index locking for mathematical accuracy
* **Deployment:** Render

**Database**
* **System:** PostgreSQL (Managed Cloud Database via Neon)
* **Integration:** `pg` package for connection pooling and sanitized SQL queries

---

## 🛠️ Local Installation & Setup

To run this quantitative engine locally, follow these steps:

### 1. Clone the repository
```bash
git clone [https://github.com/mohd-kalam121/Portfolio-Analyzer.git](https://github.com/mohd-kalam121/Portfolio-Analyzer.git)
cd Portfolio-Analyzer