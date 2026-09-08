import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  LayoutDashboard, LineChart, Save, Database, Calculator,
  TrendingUp, Loader2, Plus, Trash2, ShieldAlert
} from 'lucide-react';

// Configured at build time so the same bundle can target a local API, a preview
// deployment or production without a code change. Falls back to the deployed API.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || 'https://portfolio-analyzer-api-9g75.onrender.com';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const asPercent = (value, dp = 2) =>
  value === null || value === undefined ? '--' : `${(value * 100).toFixed(dp)}%`;

/** Parse a JSON response, surfacing the API error message when there is one. */
async function callApi(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.code = payload?.code;
    error.requestId = payload?.requestId;
    throw error;
  }
  return payload;
}

function App() {
  const [activeTab, setActiveTab] = useState('portfolio');

  // --- PORTFOLIO STATE ---
  // A list rather than fixed ticker1/ticker2 fields, so the UI can express the
  // N-asset portfolios the API actually supports.
  const [holdings, setHoldings] = useState([
    { ticker: 'NVDA', weight: '0.60' },
    { ticker: 'MSFT', weight: '0.40' }
  ]);
  const [portfolioName, setPortfolioName] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);
  const [savedPortfolios, setSavedPortfolios] = useState([]);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // --- OPTIONS STATE ---
  const [optionParams, setOptionParams] = useState({
    S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, N: 500
  });
  const [optionType, setOptionType] = useState('call');
  const [exerciseStyle, setExerciseStyle] = useState('european');
  const [optionResult, setOptionResult] = useState(null);
  const [optionError, setOptionError] = useState(null);
  const [isPricing, setIsPricing] = useState(false);

  const weightTotal = holdings.reduce((sum, h) => sum + (Number(h.weight) || 0), 0);
  const weightsBalanced = Math.abs(weightTotal - 1) <= 0.001;

  const updateHolding = (index, field, value) =>
    setHoldings(holdings.map((h, i) => (i === index ? { ...h, [field]: value } : h)));

  const addHolding = () =>
    setHoldings([...holdings, { ticker: '', weight: '0' }]);

  const removeHolding = (index) =>
    setHoldings(holdings.filter((_, i) => i !== index));

  /** Distribute weight evenly, the usual fix for a portfolio that will not balance. */
  const equalise = () => {
    const share = (1 / holdings.length);
    setHoldings(holdings.map((h, i) => ({
      ...h,
      // Give the rounding remainder to the last holding so the total is exactly 1.
      weight: (i === holdings.length - 1
        ? (1 - share * (holdings.length - 1))
        : share).toFixed(4)
    })));
  };

  const analysePortfolio = async () => {
    setErrorMessage(null);
    setSaveMessage(null);
    setAnalysis(null);
    setIsAnalysing(true);

    try {
      const data = await callApi('/api/portfolio', {
        method: 'POST',
        body: {
          assets: holdings.map(h => h.ticker.trim().toUpperCase()),
          weights: holdings.map(h => Number(h.weight))
        }
      });
      setAnalysis(data);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsAnalysing(false);
    }
  };

  const savePortfolio = async () => {
    if (!portfolioName.trim()) {
      setSaveMessage({ ok: false, text: 'Enter a name for this configuration.' });
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Only the allocation is sent. The API recomputes and stores the metrics
      // itself, so a saved record always matches its stated holdings.
      await callApi('/api/save', {
        method: 'POST',
        body: {
          name: portfolioName.trim(),
          assets: holdings.map(h => h.ticker.trim().toUpperCase()),
          weights: holdings.map(h => Number(h.weight))
        }
      });
      setSaveMessage({ ok: true, text: 'Portfolio saved.' });
      setPortfolioName('');
    } catch (error) {
      setSaveMessage({ ok: false, text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const fetchSavedPortfolios = async () => {
    setErrorMessage(null);
    try {
      const data = await callApi('/api/portfolios');
      setSavedPortfolios(data.data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const priceOption = async () => {
    setIsPricing(true);
    setOptionError(null);
    try {
      const data = await callApi('/api/options/crr', {
        method: 'POST',
        body: {
          ...Object.fromEntries(
            Object.entries(optionParams).map(([k, v]) => [k, Number(v)])
          ),
          optionType,
          exerciseStyle
        }
      });
      setOptionResult(data);
    } catch (error) {
      setOptionError(error.message);
      setOptionResult(null);
    } finally {
      setIsPricing(false);
    }
  };

  const chartData = analysis
    ? analysis.breakdown.map(asset => ({ name: asset.ticker, value: asset.weight * 100 }))
    : [];

  const inputClass = 'w-full p-3 mt-1 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none text-slate-700';
  const labelClass = 'text-sm font-semibold text-slate-600 tracking-wide uppercase';
  const cardClass = 'bg-white p-8 rounded-2xl shadow-sm border border-slate-100';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">

      <nav className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-10 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg"><TrendingUp className="text-white" size={24} /></div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">
            Quant<span className="text-blue-600">Terminal</span>
          </h1>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
          {[
            { id: 'portfolio', label: 'Portfolio Risk', Icon: LayoutDashboard },
            { id: 'options', label: 'Options Pricing', Icon: LineChart }
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${
                activeTab === id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto mt-10 px-6">

        {activeTab === 'portfolio' && (
          <div className="space-y-8">

            <div className={cardClass}>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Asset Allocation</h2>
                  <p className="text-slate-500 mt-1">
                    Weights are constrained to sum to 1.0 across up to 12 holdings.
                  </p>
                </div>
                <div className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap ${
                  weightsBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  Σw = {weightTotal.toFixed(4)}
                </div>
              </div>

              {errorMessage && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg font-medium">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-3 mb-6">
                {holdings.map((holding, index) => (
                  <div key={index} className="flex gap-3 items-end p-4 border border-slate-100 bg-slate-50 rounded-xl">
                    <div className="flex-1">
                      <label className={labelClass}>Ticker</label>
                      <input
                        type="text"
                        value={holding.ticker}
                        onChange={(e) => updateHolding(index, 'ticker', e.target.value)}
                        className={inputClass}
                        placeholder="e.g. NVDA"
                      />
                    </div>
                    <div className="w-40">
                      <label className={labelClass}>Weight</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={holding.weight}
                        onChange={(e) => updateHolding(index, 'weight', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <button
                      onClick={() => removeHolding(index)}
                      disabled={holdings.length <= 2}
                      title={holdings.length <= 2 ? 'A portfolio needs at least two assets' : 'Remove holding'}
                      className="p-3 mb-1 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mb-6">
                <button
                  onClick={addHolding}
                  disabled={holdings.length >= 12}
                  className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <Plus size={18} /> Add Asset
                </button>
                <button
                  onClick={equalise}
                  className="px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Equal Weight
                </button>
              </div>

              <button
                onClick={analysePortfolio}
                disabled={isAnalysing}
                className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ${
                  isAnalysing ? 'bg-slate-400 cursor-not-allowed text-slate-100' : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isAnalysing
                  ? <><Loader2 className="animate-spin" size={20} /> Fetching Market Data...</>
                  : <><Calculator size={20} /> Analyse Risk</>}
              </button>
            </div>

            {analysis && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricTile
                    label="Expected Return"
                    value={analysis.formatted.expectedAnnualReturn}
                    caption="annualised"
                    tone="blue"
                  />
                  <MetricTile
                    label="Volatility"
                    value={analysis.formatted.annualVolatility}
                    caption="annualised σ"
                    tone="slate"
                  />
                  <MetricTile
                    label="Sharpe Ratio"
                    value={analysis.metrics.sharpeRatio.toFixed(2)}
                    caption={`vs ${asPercent(analysis.metrics.riskFreeRate, 1)} risk-free`}
                    tone={analysis.metrics.sharpeRatio >= 1 ? 'emerald' : 'slate'}
                  />
                  <MetricTile
                    label="1-Day VaR"
                    value={analysis.formatted.valueAtRisk}
                    caption={`${asPercent(analysis.metrics.valueAtRisk.confidence, 0)} confidence`}
                    tone="amber"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className={`${cardClass} lg:col-span-1`}>
                    <h3 className="text-lg font-bold text-slate-800 mb-4">Allocation</h3>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                            {chartData.map((entry, index) => (
                              <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => `${value.toFixed(2)}%`}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-slate-500 text-center mt-2">
                      Diversification ratio {analysis.metrics.diversificationRatio.toFixed(2)}
                      {' · '}{analysis.observations} trading days
                    </p>
                  </div>

                  <div className={`${cardClass} lg:col-span-2 overflow-x-auto`}>
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Risk Decomposition</h3>
                    <p className="text-sm text-slate-500 mb-4">
                      Weight is capital allocated; risk contribution is the share of portfolio
                      variance each holding is responsible for. They differ whenever an asset is
                      more volatile or more correlated than the rest.
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="pb-2 font-semibold">Asset</th>
                          <th className="pb-2 font-semibold text-right">Weight</th>
                          <th className="pb-2 font-semibold text-right">Return</th>
                          <th className="pb-2 font-semibold text-right">Volatility</th>
                          <th className="pb-2 font-semibold text-right">Max DD</th>
                          <th className="pb-2 font-semibold text-right">Risk Contrib.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.breakdown.map((asset, index) => (
                          <tr key={asset.ticker} className="border-b border-slate-50">
                            <td className="py-3 font-semibold text-slate-800">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              {asset.ticker}
                            </td>
                            <td className="py-3 text-right text-slate-600">{asPercent(asset.weight, 1)}</td>
                            <td className={`py-3 text-right font-medium ${
                              asset.annualReturn >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {asPercent(asset.annualReturn)}
                            </td>
                            <td className="py-3 text-right text-slate-600">{asPercent(asset.annualVolatility)}</td>
                            <td className="py-3 text-right text-slate-600">{asPercent(asset.maxDrawdown)}</td>
                            <td className="py-3 text-right font-semibold text-slate-800">
                              {asPercent(asset.riskContribution, 1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={cardClass}>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">Correlation Matrix</h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Pairwise return correlation. Lower values off the diagonal mean more
                    diversification benefit is available.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-sm border-collapse">
                      <thead>
                        <tr>
                          <th className="p-2"></th>
                          {analysis.assets.map(ticker => (
                            <th key={ticker} className="p-2 font-semibold text-slate-600">{ticker}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.correlationMatrix.map((row, i) => (
                          <tr key={analysis.assets[i]}>
                            <th className="p-2 text-left font-semibold text-slate-600">{analysis.assets[i]}</th>
                            {row.map((value, j) => (
                              <td
                                key={j}
                                className="p-2 text-center font-medium rounded"
                                style={{
                                  // Blue for positive correlation, amber for negative;
                                  // opacity tracks magnitude.
                                  backgroundColor: value >= 0
                                    ? `rgba(59, 130, 246, ${Math.abs(value) * 0.35})`
                                    : `rgba(245, 158, 11, ${Math.abs(value) * 0.35})`
                                }}
                              >
                                {value.toFixed(2)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={cardClass}>
                  <h3 className="text-lg font-bold text-slate-800 mb-4">Save Configuration</h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      placeholder="Name this allocation..."
                      value={portfolioName}
                      onChange={(e) => setPortfolioName(e.target.value)}
                      maxLength={100}
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={savePortfolio}
                      disabled={isSaving}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
                    >
                      {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                      Save
                    </button>
                  </div>
                  {saveMessage && (
                    <p className={`text-sm font-medium mt-3 ${saveMessage.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                      {saveMessage.text}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className={cardClass}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Saved Portfolios</h3>
                  <p className="text-sm text-slate-500">Persisted to PostgreSQL with server-computed metrics</p>
                </div>
                <button
                  onClick={fetchSavedPortfolios}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors"
                >
                  <Database size={18} /> Fetch Records
                </button>
              </div>

              {savedPortfolios.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedPortfolios.map((p) => (
                    <div key={p.id} className="p-5 border border-slate-200 rounded-xl bg-slate-50 hover:border-blue-300 transition-colors">
                      <h4 className="font-bold text-slate-800 mb-3">{p.name}</h4>
                      <div className="space-y-2 text-sm text-slate-600">
                        <Row label="Assets" value={p.assets.join(', ')} />
                        <Row label="Return" value={asPercent(p.expected_return)} strong />
                        <Row label="Volatility" value={asPercent(p.annual_volatility)} />
                        <Row label="Sharpe" value={p.sharpe_ratio?.toFixed(2) ?? '--'} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'options' && (
          <div className={cardClass}>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-800">Binomial Options Pricing</h2>
              <p className="text-slate-500 mt-1">
                Cox-Ross-Rubinstein lattice with backward induction, validated against the
                Black-Scholes closed form.
              </p>
            </div>

            {optionError && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg font-medium flex gap-2">
                <ShieldAlert size={20} className="shrink-0" /> {optionError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[
                { key: 'S', label: 'Spot Price (S)', step: '1' },
                { key: 'K', label: 'Strike Price (K)', step: '1' },
                { key: 'T', label: 'Time to Expiry (years)', step: '0.1' },
                { key: 'r', label: 'Risk-Free Rate (r)', step: '0.01' },
                { key: 'sigma', label: 'Volatility (σ)', step: '0.01' },
                { key: 'N', label: 'Tree Steps (N)', step: '50' }
              ].map(({ key, label, step }) => (
                <div key={key}>
                  <label className={labelClass}>{label}</label>
                  <input
                    type="number"
                    step={step}
                    value={optionParams[key]}
                    onChange={(e) => setOptionParams({ ...optionParams, [key]: e.target.value })}
                    className={inputClass}
                  />
                </div>
              ))}

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                <ToggleGroup
                  label="Option Type"
                  value={optionType}
                  onChange={setOptionType}
                  options={[{ value: 'call', label: 'Call' }, { value: 'put', label: 'Put' }]}
                />
                <ToggleGroup
                  label="Exercise Style"
                  value={exerciseStyle}
                  onChange={setExerciseStyle}
                  options={[{ value: 'european', label: 'European' }, { value: 'american', label: 'American' }]}
                />
              </div>
            </div>

            <button
              onClick={priceOption}
              disabled={isPricing}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-md"
            >
              {isPricing
                ? <><Loader2 className="animate-spin" size={20} /> Computing Lattice...</>
                : <><Calculator size={20} /> Run CRR Pricing</>}
            </button>

            {optionResult && (
              <div className="mt-8 space-y-4">
                <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h3 className="text-emerald-800 font-bold mb-1">Theoretical Present Value</h3>
                    <p className="text-sm text-emerald-600 font-medium">
                      {optionResult.parameters.exerciseStyle} {optionResult.parameters.optionType},
                      {' '}{optionResult.parameters.N} steps
                    </p>
                  </div>
                  <span className="text-4xl font-extrabold text-emerald-700 tracking-tighter">
                    ${optionResult.presentValue.toFixed(4)}
                  </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricTile label="Delta" value={optionResult.greeks.delta?.toFixed(4) ?? '--'} caption="∂V/∂S" tone="slate" />
                  <MetricTile label="Gamma" value={optionResult.greeks.gamma?.toFixed(4) ?? '--'} caption="∂²V/∂S²" tone="slate" />
                  <MetricTile label="Theta" value={optionResult.greeks.theta?.toFixed(4) ?? '--'} caption="per year" tone="slate" />
                  <MetricTile
                    label="Risk-Neutral p"
                    value={optionResult.model.riskNeutralProbability.toFixed(4)}
                    caption="must lie in (0,1)"
                    tone="slate"
                  />
                </div>

                {optionResult.reference && (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl">
                    <h4 className="font-bold text-slate-700 mb-2">Convergence Check</h4>
                    <p className="text-sm text-slate-600">
                      Black-Scholes closed form prices this at{' '}
                      <span className="font-semibold text-slate-900">
                        ${optionResult.reference.presentValue.toFixed(4)}
                      </span>
                      , a difference of{' '}
                      <span className="font-semibold text-slate-900">
                        ${optionResult.reference.absoluteDifference.toFixed(6)}
                      </span>
                      . The binomial model converges to this analytic value at order 1/N, so
                      raising the step count narrows the gap.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MetricTile({ label, value, caption, tone }) {
  const tones = {
    blue: 'from-blue-50 to-white border-blue-100 text-blue-600',
    emerald: 'from-emerald-50 to-white border-emerald-100 text-emerald-600',
    amber: 'from-amber-50 to-white border-amber-100 text-amber-600',
    slate: 'from-slate-50 to-white border-slate-200 text-slate-800'
  };
  const [gradient, border, text] = (tones[tone] || tones.slate).split(' ');

  return (
    <div className={`bg-gradient-to-br ${gradient} ${border} border rounded-2xl p-5 shadow-sm`}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-extrabold tracking-tight mt-2 ${text}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-1">{caption}</p>
    </div>
  );
}

function ToggleGroup({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-sm font-semibold text-slate-600 tracking-wide uppercase">{label}</label>
      <div className="flex gap-3 mt-2">
        {options.map(option => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all ${
              value === option.value
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between border-b border-slate-200 pb-1 gap-3">
      <span>{label}</span>
      <span className={`font-medium text-right ${strong ? 'text-emerald-600 font-bold' : 'text-slate-900'}`}>
        {value}
      </span>
    </div>
  );
}

export default App;
