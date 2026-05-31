import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LayoutDashboard, LineChart, Save, Database, Calculator, TrendingUp, Loader2 } from 'lucide-react';

function App() {
  // --- PRODUCTION API ROUTE ---
  // Hardcoding the production Render URL to guarantee the connection works on Vercel
  const API_BASE = 'https://portfolio-analyzer-api-9g75.onrender.com';

  // --- NAVIGATION STATE ---
  const [activeTab, setActiveTab] = useState('portfolio');

  // --- PORTFOLIO STATE ---
  const [portfolioData, setPortfolioData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);
  const [savedPortfolios, setSavedPortfolios] = useState([]);
  
  const [portfolioName, setPortfolioName] = useState("");
  const [ticker1, setTicker1] = useState("NVDA");
  const [weight1, setWeight1] = useState("0.60");
  const [ticker2, setTicker2] = useState("MSFT");
  const [weight2, setWeight2] = useState("0.40");
  const [isFetchingPortfolio, setIsFetchingPortfolio] = useState(false);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']; // Modern Tailwind Colors

  // --- OPTIONS SIMULATOR STATE ---
  const [S, setS] = useState(100);
  const [K, setK] = useState(100);
  const [T, setT] = useState(1);
  const [r, setR] = useState(0.05);
  const [sigma, setSigma] = useState(0.20);
  const [N, setN] = useState(100);
  const [optionType, setOptionType] = useState('call');
  const [optionResult, setOptionResult] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // --- PORTFOLIO FUNCTIONS ---
  const analyzePortfolio = async () => {
    setErrorMessage(null); 
    setPortfolioData(null); 
    setSaveMessage(null);
    setIsFetchingPortfolio(true); // Turn spinner ON

    try {
      const response = await fetch(`${API_BASE}/api/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: [ticker1.toUpperCase(), ticker2.toUpperCase()],
          weights: [Number(weight1), Number(weight2)]
        })
      });
      const data = await response.json();
      if (!response.ok) setErrorMessage(data.message);
      else setPortfolioData(data);
    } catch (error) { 
      setErrorMessage("Error connecting to backend."); 
    } finally {
      setIsFetchingPortfolio(false); // Turn spinner OFF
    }
  };

  const savePortfolioToDB = async () => {
    if (!portfolioName.trim()) {
      setSaveMessage("❌ Please enter a name for your portfolio.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: portfolioName,
          assets: portfolioData.assets,
          weights: portfolioData.weights,
          expected_portfolio_return: portfolioData.expected_portfolio_return
        })
      });
      const data = await response.json();
      if (response.ok) {
        setSaveMessage("✅ Portfolio permanently saved!");
        setPortfolioName(""); // Clear input on success
      } else {
        setSaveMessage(data.message || "Failed to save.");
      }
    } catch (error) { setSaveMessage("Error saving to database."); }
  };

  const fetchSavedPortfolios = async () => {
    setErrorMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/portfolios`);
      const data = await response.json();
      if (response.ok) setSavedPortfolios(data.data);
      else setErrorMessage(data.message || "Failed to fetch portfolios.");
    } catch (error) { setErrorMessage("Error connecting to backend."); }
  };

  const chartData = portfolioData ? portfolioData.assets.map((asset, index) => ({
    name: asset, value: portfolioData.weights[index] * 100 
  })) : [];

  // --- OPTIONS FUNCTIONS ---
  const calculateOption = async () => {
    setIsCalculating(true);
    try {
      const response = await fetch(`${API_BASE}/api/options/crr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          S: Number(S), K: Number(K), T: Number(T), r: Number(r), sigma: Number(sigma), N: Number(N), optionType
        })
      });
      const data = await response.json();
      setOptionResult(data.present_value);
    } catch (error) { console.error("Option calculation failed", error); }
    setIsCalculating(false);
  };

  // --- REUSABLE UI CLASSES ---
  const inputClass = "w-full p-3 mt-1 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none text-slate-700";
  const labelClass = "text-sm font-semibold text-slate-600 tracking-wide uppercase";
  const cardClass = "bg-white p-8 rounded-2xl shadow-sm border border-slate-100";

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      
      {/* TOP NAVIGATION BAR */}
      <nav className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-10 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg"><TrendingUp className="text-white" size={24} /></div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Quant<span className="text-blue-600">Terminal</span></h1>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setActiveTab('portfolio')} className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${activeTab === 'portfolio' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <LayoutDashboard size={18} /> Portfolio
          </button>
          <button onClick={() => setActiveTab('options')} className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${activeTab === 'options' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <LineChart size={18} /> Options CRR
          </button>
        </div>
      </nav>

      {/* MAIN DASHBOARD CONTAINER */}
      <main className="max-w-5xl mx-auto mt-10 px-6">

        {/* TAB CONTENT: PORTFOLIO OPTIMIZER */}
        {activeTab === 'portfolio' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className={cardClass}>
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Asset Allocation</h2>
                <p className="text-slate-500 mt-1">Configure portfolio weights. Constraints dictate Σ w_i = 1.0</p>
              </div>
              
              {errorMessage && <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg font-medium">{errorMessage}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="p-5 border border-slate-100 bg-slate-50 rounded-xl space-y-4">
                  <div><label className={labelClass}>Asset 1 Ticker</label><input type="text" value={ticker1} onChange={(e) => setTicker1(e.target.value)} className={inputClass} placeholder="e.g. NVDA" /></div>
                  <div><label className={labelClass}>Weight (w1)</label><input type="number" value={weight1} onChange={(e) => setWeight1(e.target.value)} step="0.1" className={inputClass} /></div>
                </div>
                <div className="p-5 border border-slate-100 bg-slate-50 rounded-xl space-y-4">
                  <div><label className={labelClass}>Asset 2 Ticker</label><input type="text" value={ticker2} onChange={(e) => setTicker2(e.target.value)} className={inputClass} placeholder="e.g. MSFT" /></div>
                  <div><label className={labelClass}>Weight (w2)</label><input type="number" value={weight2} onChange={(e) => setWeight2(e.target.value)} step="0.1" className={inputClass} /></div>
                </div>
              </div>
              
            <button 
              onClick={analyzePortfolio} 
              disabled={isFetchingPortfolio}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ${
                isFetchingPortfolio 
                  ? 'bg-slate-400 cursor-not-allowed text-slate-100' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isFetchingPortfolio ? (
                <>
                  <Loader2 className="animate-spin" size={20} /> Fetching Market Data...
                </>
              ) : (
                <>
                  <Calculator size={20} /> Calculate Expected Return
                </>
              )}
            </button>
            </div>

            {/* RESULTS SECTION */}
            {portfolioData && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-500">
                <div className={`${cardClass} md:col-span-1 flex flex-col justify-center items-center text-center bg-gradient-to-br from-blue-50 to-white border-blue-100`}>
                  <p className="text-slate-500 font-semibold mb-2">Expected Annual Return</p>
                  <h3 className="text-5xl font-extrabold text-blue-600 tracking-tighter">{portfolioData.expected_portfolio_return}</h3>
                  <p className="text-xs text-green-600 font-medium mt-4 bg-green-50 px-3 py-1 rounded-full">{portfolioData.message}</p>
                </div>

                <div className={`${cardClass} md:col-span-2 flex items-center justify-between`}>
                   <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                          {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}/>
                        <Legend verticalAlign="middle" layout="vertical" align="right" />
                      </PieChart>
                    </ResponsiveContainer>
                   </div>
                   <div className="flex flex-col gap-3 min-w-[200px]">
                      {/* NEW PORTFOLIO NAMING INPUT */}
                      <input 
                        type="text"
                        placeholder="Name your config..."
                        value={portfolioName}
                        onChange={(e) => setPortfolioName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button onClick={savePortfolioToDB} className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors">
                        <Save size={18} /> Save Config
                      </button>
                      {saveMessage && <p className={`text-sm font-medium text-center ${saveMessage.includes('❌') ? 'text-red-600' : 'text-emerald-600'}`}>{saveMessage}</p>}
                   </div>
                </div>
              </div>
            )}

            {/* DATABASE SECTION */}
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Cloud Database</h3>
                  <p className="text-sm text-slate-500">PostgreSQL instance connected</p>
                </div>
                <button onClick={fetchSavedPortfolios} className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors">
                  <Database size={18} /> Fetch Records
                </button>
              </div>

              {savedPortfolios.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {savedPortfolios.map((p) => (
                    <div key={p.id} className="p-5 border border-slate-200 rounded-xl bg-slate-50 hover:border-blue-300 transition-colors">
                      <h4 className="font-bold text-slate-800 mb-3">{p.name}</h4>
                      <div className="space-y-2 text-sm text-slate-600">
                        <div className="flex justify-between border-b border-slate-200 pb-1"><span>Assets</span> <span className="font-medium text-slate-900">{p.assets.join(', ')}</span></div>
                        <div className="flex justify-between border-b border-slate-200 pb-1"><span>Weights</span> <span className="font-medium text-slate-900">{p.weights.join(', ')}</span></div>
                        <div className="flex justify-between pt-1"><span>Return</span> <span className="font-bold text-emerald-600">{p.expected_return}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB CONTENT: OPTIONS SIMULATOR */}
        {activeTab === 'options' && (
          <div className={`animate-in fade-in slide-in-from-bottom-4 duration-500 ${cardClass}`}>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-800">Binomial Options Pricing (CRR)</h2>
              <p className="text-slate-500 mt-1">Calculate theoretical fair value using dynamic programming tree traversal.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div><label className={labelClass}>Spot Price (S)</label><input type="number" value={S} onChange={e => setS(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>Strike Price (K)</label><input type="number" value={K} onChange={e => setK(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>Time (Years)</label><input type="number" value={T} onChange={e => setT(e.target.value)} step="0.1" className={inputClass} /></div>
              <div><label className={labelClass}>Risk-Free Rate (r)</label><input type="number" value={r} onChange={e => setR(e.target.value)} step="0.01" className={inputClass} /></div>
              <div><label className={labelClass}>Volatility (σ)</label><input type="number" value={sigma} onChange={e => setSigma(e.target.value)} step="0.01" className={inputClass} /></div>
              <div><label className={labelClass}>Tree Steps (N)</label><input type="number" value={N} onChange={e => setN(e.target.value)} className={inputClass} /></div>
              
              <div className="md:col-span-3">
                <label className={labelClass}>Option Type</label>
                <div className="flex gap-4 mt-2">
                  <button onClick={() => setOptionType('call')} className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all ${optionType === 'call' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>Call Option</button>
                  <button onClick={() => setOptionType('put')} className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all ${optionType === 'put' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>Put Option</button>
                </div>
              </div>
            </div>

            <button onClick={calculateOption} className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-md">
              <Calculator size={20} /> {isCalculating ? 'Computing Matrix...' : 'Run CRR Simulation'}
            </button>

            {optionResult && (
              <div className="mt-8 p-6 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="text-emerald-800 font-bold mb-1">Theoretical Present Value</h3>
                  <p className="text-sm text-emerald-600 font-medium">Calculated over {N} nodes.</p>
                </div>
                <span className="text-4xl font-extrabold text-emerald-700 tracking-tighter">${optionResult}</span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;