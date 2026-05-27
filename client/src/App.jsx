import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

function App() {
  const [portfolioData, setPortfolioData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);

  const [savedPortfolios, setSavedPortfolios] = useState([]);
  

  const [ticker1, setTicker1] = useState("NVDA");
  const [weight1, setWeight1] = useState("0.60");
  
  const [ticker2, setTicker2] = useState("MSFT");
  const [weight2, setWeight2] = useState("0.40");

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

  const analyzePortfolio = async () => {
    setErrorMessage(null);
    setPortfolioData(null);
    setSaveMessage(null);

    try {
      const response = await fetch('http://localhost:3000/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: [ticker1.toUpperCase(), ticker2.toUpperCase()],
          weights: [Number(weight1), Number(weight2)]
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setErrorMessage(data.message);
      } else {
        setPortfolioData(data);
      }
    } catch (error) {
      setErrorMessage("Error connecting to backend.");
    }
  };

  // NEW FUNCTION: Sends the data to our new Postgres route
  const savePortfolioToDB = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: "My Tech Portfolio",
          assets: portfolioData.assets,
          weights: portfolioData.weights,
          expected_portfolio_return: portfolioData.expected_portfolio_return
        })
      });
      
      const data = await response.json();
      setSaveMessage(data.message);
    } catch (error) {
      setSaveMessage("Error saving to database.");
    }
  };

  const fetchSavedPortfolios = async () => {
    setErrorMessage(null);
    try {
      const response = await fetch('http://localhost:3000/api/portfolios');
      const data = await response.json();
      
      if (response.ok) {
        setSavedPortfolios(data.data);
      } else {
        setErrorMessage(data.message || "Failed to fetch portfolios.");
      }
    } catch (error) {
      setErrorMessage("Error connecting to backend to fetch data.");
    }
  };

  const chartData = portfolioData ? portfolioData.assets.map((asset, index) => ({
    name: asset,
    value: portfolioData.weights[index] * 100 
  })) : [];

  return (
    <div style={{ padding: '50px', fontFamily: 'Arial', maxWidth: '600px' }}>
      <h1>Portfolio Analyzer</h1>
      <p>Enter your stock tickers and weights. Weights must sum to 1.0.</p>
      
      {errorMessage && (
        <div style={{ padding: '15px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '5px', marginBottom: '20px' }}>
          <strong>Error: </strong> {errorMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <div>
          <h3>Asset 1</h3>
          <label>Ticker Symbol: </label><br/>
          <input type="text" value={ticker1} onChange={(e) => setTicker1(e.target.value)} /><br/><br/>
          <label>Weight (e.g., 0.60): </label><br/>
          <input type="number" value={weight1} onChange={(e) => setWeight1(e.target.value)} step="0.1" />
        </div>

        <div>
          <h3>Asset 2</h3>
          <label>Ticker Symbol: </label><br/>
          <input type="text" value={ticker2} onChange={(e) => setTicker2(e.target.value)} /><br/><br/>
          <label>Weight (e.g., 0.40): </label><br/>
          <input type="number" value={weight2} onChange={(e) => setWeight2(e.target.value)} step="0.1" />
        </div>
      </div>
      
      <button 
        onClick={analyzePortfolio}
        style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        Fetch Live Data & Calculate
      </button>

      {portfolioData && (
        <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#e8f5e9', borderRadius: '8px' }}>
          <h2>Result from Live Market:</h2>
          <p><strong>Status:</strong> {portfolioData.message}</p>
          <p><strong>Estimated 52-Week Return:</strong> <span style={{ color: '#2e7d32', fontSize: '24px', fontWeight: 'bold' }}>{portfolioData.expected_portfolio_return}</span></p>
          
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
            <PieChart width={300} height={300}>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </div>

          {/* NEW DATABASE SAVE BUTTON */}
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <button 
              onClick={savePortfolioToDB}
              style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px' }}
            >
              💾 Save Portfolio to Database
            </button>
            
            {saveMessage && (
              <p style={{ marginTop: '10px', fontWeight: 'bold', color: '#155724' }}>
                {saveMessage}
              </p>
            )}
          </div>

        </div>
      )}

      <hr style={{ margin: '40px 0' }} />
      
      <h2>Database Records</h2>
      <button onClick={fetchSavedPortfolios} style={{ marginBottom: '20px' }}>
        Load Saved Portfolios
      </button>

      {savedPortfolios.length > 0 && (
        <div>
          {savedPortfolios.map((portfolio) => (
            <div 
              key={portfolio.id} 
              style={{ 
                border: '1px solid #ccc', 
                padding: '15px', 
                marginBottom: '15px', 
                borderRadius: '8px',
                backgroundColor: '#f9f9f9'
              }}
            >
              <h3 style={{ margin: '0 0 10px 0' }}>{portfolio.name}</h3>
              <p style={{ margin: '5px 0' }}><strong>Assets:</strong> {portfolio.assets.join(', ')}</p>
              <p style={{ margin: '5px 0' }}><strong>Weights:</strong> {portfolio.weights.join(', ')}</p>
              <p style={{ margin: '5px 0' }}><strong>Expected Return:</strong> {portfolio.expected_return}</p>
              <p style={{ fontSize: '0.8em', color: '#666', marginTop: '10px' }}>
                Saved on: {new Date(portfolio.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;