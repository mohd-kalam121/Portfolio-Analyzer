# QuantTerminal

A portfolio risk and derivatives pricing service. It pulls historical prices from
a live market data feed, builds the covariance structure of a multi-asset
portfolio, and reports the risk decomposition that follows from it — expected
return, volatility, Sharpe ratio, Value at Risk, and each holding's marginal
contribution to total risk. It also prices European and American options on a
Cox-Ross-Rubinstein binomial lattice.

[![CI](https://github.com/mohd-kalam121/Portfolio-Analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/mohd-kalam121/Portfolio-Analyzer/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-115%20passing-brightgreen)
![License](https://img.shields.io/badge/license-ISC-blue)

**Live demo:** [portfolio-analyzer-three.vercel.app](https://portfolio-analyzer-three.vercel.app/) ·
**API:** [/health](https://portfolio-analyzer-api-9g75.onrender.com/health)

> Both are on free tiers, so the first request after an idle period takes 30-50
> seconds while the API cold-starts.

---

## Contents

- [What it computes](#what-it-computes)
- [Architecture](#architecture)
- [Engineering decisions](#engineering-decisions)
- [API reference](#api-reference)
- [Testing](#testing)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Limitations](#limitations)

---

## What it computes

### Portfolio risk

Given assets with weights **w** summing to 1, the service fetches one year of
daily closes, converts them to simple returns, and builds the sample covariance
matrix **Σ** (annualised by 252 trading days).

| Metric | Definition |
|---|---|
| Expected return | `E[R_p] = Σ wᵢ · E[Rᵢ]` |
| Variance | `σ²_p = wᵀ Σ w` |
| Volatility | `σ_p = √(wᵀ Σ w)` |
| Sharpe ratio | `(E[R_p] − r_f) / σ_p` |
| Diversification ratio | `(Σ wᵢσᵢ) / σ_p` — how much risk the correlation structure removes |
| Value at Risk | `z_α · σ_daily − μ_daily`, parametric, 1-day, 95% by default |
| Risk contribution | `wᵢ (Σw)ᵢ / σ²_p` — Euler decomposition; sums to 1 across holdings |
| Max drawdown | Largest peak-to-trough decline over the window |

The **risk contribution** column is the one worth reading. Capital weight and
risk weight are different numbers: a 20% allocation to a volatile, highly
correlated asset can easily be responsible for 45% of portfolio variance. The
API reports both side by side.

### Options pricing

A Cox-Ross-Rubinstein lattice with `u = e^(σ√Δt)`, `d = 1/u`, and risk-neutral
probability `p = (e^(rΔt) − d) / (u − d)`, solved by backward induction.

- **European and American** exercise. American nodes compare continuation value
  against immediate exercise at every step, which is the reason to use a lattice
  rather than a closed form at all.
- **Greeks** (delta, gamma, theta) read directly off the lattice by finite
  difference, using node values already computed during induction.
- **Black-Scholes reference** returned alongside every European price, with the
  absolute gap between the two, so the discretisation error is visible rather
  than implied.

---

## Architecture

```
client/                  React 19 + Vite + Tailwind, deployed on Vercel
│
└── HTTPS
    │
src/
├── app.js               Express app factory (no side effects on import)
├── server.js            Boot: migrate, listen, graceful shutdown
├── config/              All environment coupling, validated at startup
├── routes/              HTTP: validate, delegate, serialise
│   ├── portfolio.js
│   ├── options.js
│   └── health.js
├── services/            Business logic, no framework dependency
│   ├── riskEngine.js        Covariance, VaR, risk decomposition (pure)
│   ├── optionsEngine.js     CRR lattice + Black-Scholes (pure)
│   ├── marketData.js        Feed client: cache, retry, timeout
│   ├── portfolioService.js  Orchestration
│   └── portfolioValidator.js
├── middleware/          Errors, rate limiting, request context
├── db/                  Pool, migrations, repository (all SQL lives here)
└── utils/               TTL cache, error types
     │
     └── PostgreSQL (Neon) · Yahoo Finance chart API
```

The dependency direction is one-way: routes depend on services, services depend
on utilities, and nothing depends on routes. `riskEngine` and `optionsEngine`
import no framework and perform no I/O, which is what makes them cheap to test
exhaustively.

---

## Engineering decisions

### The market data feed is the hard part

The upstream is free, unauthenticated and rate-limited. A naive client that
fetches per request falls over as soon as more than one person uses the
dashboard. Four mechanisms guard it:

**TTL cache.** Daily closes change once a day, so a 15-minute cached copy is
correct. Measured on a three-asset portfolio: **492 ms cold, 1 ms warm** — the
cached path is roughly 490x faster and makes zero upstream calls.

**Single-flight de-duplication.** When N concurrent requests miss on the same
ticker, only the first performs the fetch; the rest await the same promise.
Without this, a cold cache plus a burst of traffic produces a thundering herd
against precisely the dependency you are trying to protect.

Measured with 25 concurrent requests for a two-asset portfolio on a cold cache,
as reported by `/ready`:

```jsonc
{
  "hits": 0,
  "misses": 50,          // every lookup missed
  "upstreamCalls": 2,    // but only one fetch per ticker actually happened
  "coalesced": 48,       // the rest joined a request already in flight
  "deduplication": 0.96
}
```

`misses` and `upstreamCalls` are deliberately separate counters. A hit rate
alone cannot show this: every one of those 50 lookups was a miss, and the cache
still made only two calls.

**Per-attempt timeout.** An `AbortController` caps every request, so a hung
upstream cannot pin a handler open indefinitely.

**Bounded retry with jittered backoff** — but only on transient failures (5xx,
429, network errors). A 404 is never retried, because an unknown ticker will not
become known by asking again. Full jitter prevents simultaneous clients from
retrying in lockstep and re-creating the burst that caused the failure.

### Correctness of the covariance matrix

Covariance between two return series is only meaningful if observation *i* of
each refers to the same trading day. Assets on different exchanges, or with
different halt histories, return different numbers of closes. Naively zipping
them correlates Monday against Tuesday and produces a plausible, wrong number.
Every series is truncated to the shortest common length, keeping the most recent
observations, before any arithmetic happens.

### Exploiting symmetry

`Cov(i,j) = Cov(j,i)`, so only the upper triangle is computed and mirrored:
`n(n+1)/2` passes instead of `n²`. Asset means are computed once and passed into
the covariance function rather than being recomputed per matrix cell. The
portfolio variance quadratic form is likewise evaluated as diagonal terms plus
twice the upper triangle.

### The API returns numbers

An earlier version returned `"12.34%"` as a string, which forced every consumer
to parse presentation back into data and made the values unusable for charting,
sorting or storage. Metrics are now numbers; formatted strings are provided
alongside as a convenience, never as a replacement.

### Deploying the API and client independently

The two halves live in one repository but deploy to different platforms, so
during a rollout the previous client is briefly talking to the new API. Rather
than accept a window where the live page blanks its headline figure, the new
response carries the two legacy field names the old client reads alongside the
new shape — expand now, contract once the client has shipped. The compatibility
fields are marked deprecated in `portfolioService.js` and covered by a test that
asserts they agree with the numeric metrics they mirror.

### Saved records are recomputed, not trusted

`POST /api/save` accepts only the allocation. The server recomputes the metrics
before storing them. Accepting client-supplied metrics — as the earlier version
did — means a stored row is unverifiable and trivially forged.

### Security posture

- **TLS verification is on.** The database connection previously set
  `rejectUnauthorized: false`, which disables certificate validation and accepts
  any presented certificate. Managed providers present publicly signed
  certificates that Node validates against its bundled trust store; a private CA
  is supplied via `DATABASE_CA_CERT` rather than by disabling the check.
- **Errors never leak internals.** Only errors raised deliberately (`AppError`)
  are described to the client. Everything else is logged server-side in full and
  returned as a generic 500 with a correlation id. Driver messages, file paths
  and stack traces are exactly what an attacker wants and leak easily when a
  handler responds with a raw `error.message`.
- **All SQL is parameterised**, and confined to the repository layer.
- **Input is validated before it reaches a URL or a query.** Ticker symbols must
  match a strict pattern, which excludes anything that could alter the shape of
  the upstream request.
- **Work is bounded**: request bodies capped at 64 KB, portfolios at 12 assets,
  lattice steps at 5000 (the tree is O(N²), so an unbounded N is a trivial CPU
  exhaustion vector on a single-threaded event loop), and requests rate-limited
  per client.
- `npm audit` reports zero vulnerabilities in both packages.

### Operational endpoints

`/health` and `/ready` answer different questions. `/health` is cheap and touches
no dependencies — a platform uses it for liveness and must not restart the
process because Postgres blinked. `/ready` checks dependencies and returns 503
when they are down, so a load balancer stops routing traffic. Every response
carries an `X-Request-Id`, echoed from the request when supplied, and appearing
in both the access log and any error body.

---

## API reference

### `POST /api/portfolio`

```jsonc
// Request
{ "assets": ["NVDA", "MSFT", "JNJ"], "weights": [0.5, 0.3, 0.2] }
```

```jsonc
// 200 OK — a real response, abridged
{
  "status": "success",
  "assets": ["NVDA", "MSFT", "JNJ"],
  "observations": 250,
  "metrics": {
    "expectedAnnualReturn": 0.278061,
    "annualVolatility": 0.228148,
    "sharpeRatio": 1.0435,
    "diversificationRatio": 1.4338,
    "riskFreeRate": 0.04,
    "valueAtRisk": { "confidence": 0.95, "horizon": "1d", "fraction": 0.022536, "percent": 2.25 }
  },
  "formatted": { "expectedAnnualReturn": "27.81%", "annualVolatility": "22.81%" },
  "breakdown": [
    { "ticker": "NVDA", "weight": 0.5, "annualVolatility": 0.38191,
      "maxDrawdown": 0.202231, "riskContribution":  0.7612 },
    { "ticker": "MSFT", "weight": 0.3, "annualVolatility": 0.325568,
      "maxDrawdown": 0.349106, "riskContribution":  0.2586 },
    { "ticker": "JNJ",  "weight": 0.2, "annualVolatility": 0.192417,
      "maxDrawdown": 0.109591, "riskContribution": -0.0198 }
  ],
  "correlationMatrix": [[1, 0.2572, -0.223], [0.2572, 1, -0.2327], [-0.223, -0.2327, 1]]
}
```

Two things in that response are the reason the endpoint reports risk
decomposition at all:

- **NVDA holds 50% of the capital but accounts for 76% of the risk.** Capital
  weight tells you almost nothing about risk exposure.
- **JNJ's risk contribution is negative (−2%).** It is negatively correlated with
  both other holdings, so adding it *reduces* total portfolio variance — it is
  paying for itself as a hedge. A weights-only view cannot express that, and the
  diversification ratio of 1.43 is the aggregate of the same effect.

### `POST /api/options/crr`

```jsonc
// Request
{ "S": 100, "K": 100, "T": 1, "r": 0.05, "sigma": 0.2, "N": 500,
  "optionType": "call", "exerciseStyle": "european" }
```

```jsonc
// 200 OK
{
  "status": "success",
  "presentValue": 10.446585,
  "greeks": { "delta": 0.636767, "gamma": 0.018794, "theta": -6.420234 },
  "model": { "upFactor": 1.00898439, "downFactor": 0.99109561,
             "riskNeutralProbability": 0.50335432, "stepSize": 0.002 },
  "reference": { "model": "black-scholes", "presentValue": 10.450584,
                 "absoluteDifference": 0.00399844 }
}
```

### Other endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/options/black-scholes` | Closed-form European price and Greeks |
| `POST` | `/api/save` | Analyse and persist an allocation (metrics recomputed server-side) |
| `GET` | `/api/portfolios` | Saved portfolios, newest first, paginated |
| `GET` | `/api/portfolios/:id` | One saved portfolio |
| `DELETE` | `/api/portfolios/:id` | Delete a saved portfolio |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness, dependency status, cache hit rate |

### Errors

Every error has the same shape, with a stable machine-readable `code`:

```jsonc
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Weights must sum to 1.0 (received 1.4000).",
  "requestId": "59e2592d-1a29-4e4f-a366-16768a120993",
  "details": { "providedSum": 1.4, "tolerance": 0.001 }
}
```

`VALIDATION_ERROR` (400) · `NOT_FOUND` (404) · `RATE_LIMITED` (429) ·
`UPSTREAM_UNAVAILABLE` (502) · `DATABASE_UNAVAILABLE` (503) · `INTERNAL_ERROR` (500)

---

## Testing

```bash
npm test              # 115 tests
npm run test:coverage
```

Node's built-in test runner — no test framework dependency. The network and
database boundaries are stubbed, so the suite is deterministic, needs no
secrets, and runs in about a second.

The numerical code is verified against results that are true independently of
this implementation, rather than against its own output:

- **CRR converges to Black-Scholes** at the theoretical O(1/N) rate, reaching
  sub-cent accuracy by N = 2000.
- **Put-call parity** `C − P = S − Ke^(−rT)` holds to 1e-6.
- **An American put exceeds its European counterpart** (early exercise premium),
  while an American call on a non-dividend stock equals it — the standard result.
- **Lattice Greeks match the Black-Scholes closed form** to 1e-3.
- **Risk contributions sum to 1**, as Euler decomposition requires.
- **`normalCdf` inverts the risk engine's `normalQuantile`** — a round-trip
  across two independently derived approximations.
- **Black-Scholes matches the Hull textbook benchmark** of 10.4506.
- Monotonicity properties: value rises with volatility, falls with strike;
  delta stays within `(0,1)` for calls and `(−1,0)` for puts; gamma positive;
  theta negative.

Infrastructure behaviour is tested too: that concurrent misses collapse to one
upstream call, that a 404 is not retried while a 503 is, that a hung upstream is
aborted, that a failed fetch is not cached, that the LRU evicts correctly, that
hostile input reaches SQL only as a bound parameter, and that the rate limiter
returns 429 with a `Retry-After`.

Coverage on the business logic: `riskEngine` 99%, `optionsEngine` 98%,
`marketData` 98%, `portfolioValidator` 100%, `portfolioService` 100%.

---

## Running locally

```bash
git clone https://github.com/mohd-kalam121/Portfolio-Analyzer.git
cd Portfolio-Analyzer

# API
npm install
cp .env.example .env      # DATABASE_URL is optional; see below
npm run dev               # http://localhost:3000

# Client, in a second terminal
cd client
npm install
cp .env.example .env      # point VITE_API_BASE_URL at your local API
npm run dev               # http://localhost:5173
```

The API runs without a database. Pricing and risk endpoints work normally; only
the persistence routes return 503. Set `DATABASE_URL` to enable them — the
schema migrates automatically on boot, and the migrations are idempotent, so
restarting is safe.

---

## Configuration

Every tunable is an environment variable with a working default; see
[`.env.example`](.env.example). The ones that matter most:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection. Omit to run without persistence. |
| `MARKET_DATA_CACHE_TTL_MS` | `900000` | How long a price series stays cached |
| `MARKET_DATA_TIMEOUT_MS` | `8000` | Per-attempt upstream timeout |
| `RATE_LIMIT_MAX` | `60` | Requests per window per client |
| `PORTFOLIO_RISK_FREE_RATE` | `0.04` | Sharpe ratio denominator input |
| `OPTIONS_MAX_STEPS` | `5000` | Lattice ceiling |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated allow-list; empty permits any origin |

Configuration is read once at startup and validated, so a bad value fails the
boot rather than the first request that touches it.

---

## Limitations

Stated plainly, because these are the honest boundaries of what the numbers mean:

- **Parametric VaR assumes normally distributed returns.** Real return
  distributions have fat tails, so this understates extreme loss. Historical or
  Monte Carlo VaR would be the next step.
- **Past covariance is not future covariance.** One year of daily data is a
  sample, and correlations tend to rise in exactly the drawdowns where
  diversification is most needed.
- **Long-only.** Negative weights are rejected rather than silently priced as
  short positions, since the risk reporting assumes long exposure.
- **No portfolio optimisation.** The service evaluates an allocation you give
  it; it does not solve for the efficient frontier. That is the natural
  extension of the covariance machinery already here.
- **The rate limiter is per-process.** With several instances the effective limit
  is per-instance. Horizontal scaling would move the counter to Redis behind the
  same interface.
- **No authentication.** Every endpoint is public, which is appropriate for a
  public demo where nothing is user-scoped, and would not be otherwise.
- **The market data feed is unofficial** and can change shape or rate-limit
  without notice. Response parsing is isolated and fixture-tested so that a
  change breaks one tested function rather than the whole service.

---

## Stack

**API** — Node.js, Express 5, PostgreSQL (`pg`), zero test dependencies
**Client** — React 19, Vite, Tailwind CSS v4, Recharts
**Deployment** — Render (API), Vercel (client), Neon (database), GitHub Actions (CI)

## License

ISC
