# Portfolio Analyzer

A full-stack web application designed to calculate expected portfolio returns, visualize asset allocation, and persist financial data to a managed cloud database. Built with a focus on a robust REST API, strict business logic validation, and a responsive frontend.

**Live Demo:https://portfolio-analyzer-three.vercel.app/  
**Live API Endpoint:https://portfolio-analyzer-api-9g75.onrender.com/api/portfolios

---

## 🚀 Features

* **Dynamic Return Calculation:** Calculates the overall expected return of a customized stock portfolio using weighted averages.
* **Strict Constraint Validation:** Backend API enforces strict business logic, ensuring portfolio weights equal exactly 1.0 (100%) before processing or saving data.
* **Data Visualization:** Renders interactive, color-coded SVG pie charts of the user's asset allocation.
* **Cloud Persistence:** Saves and retrieves portfolio configurations and calculated metrics in real-time from a relational cloud database.
* **Separation of Concerns:** Clean decoupling of the React frontend from the Express backend API.

---

## 💻 Tech Stack

**Frontend**
* React.js (built with Vite for optimized bundling)
* Recharts (for dynamic, responsive data visualization)
* Hosted on **Vercel**

**Backend**
* Node.js & Express.js
* RESTful API architecture (GET and POST endpoints)
* CORS & Dotenv for security and environment variable management
* Hosted on **Render**

**Database**
* PostgreSQL (Managed Cloud Database via **Neon**)
* `pg` package for connection pooling and SQL queries

---

## 🛠️ Local Installation & Setup

If you want to run this project locally, follow these steps:

### 1. Clone the repository
```bash
git clone [https://github.com/mohd-kalam121/Portfolio-Analyzer.git](https://github.com/mohd-kalam121/Portfolio-Analyzer.git)
cd Portfolio-Analyzer