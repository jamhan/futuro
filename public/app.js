const API_BASE = typeof window !== 'undefined' && window.location.origin
  ? window.location.origin + '/api'
  : '/api';

function escapeHtml(s) {
  if (s == null || typeof s !== 'string') return '';
  const div = typeof document !== 'undefined' && document.createElement ? document.createElement('div') : null;
  if (div) { div.textContent = s; return div.innerHTML; }
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function apiHeaders() {
  const code = typeof localStorage !== 'undefined' && localStorage.getItem('inviteCode');
  return code ? { 'X-Invite-Code': code } : {};
}

function checkInviteRequired(res, body) {
  if (res.status === 401 && body && body.code === 'INVITE_REQUIRED') {
    state.inviteRequired = true;
    return true;
  }
  if (res.status === 401 && body && body.code === 'API_KEY_REQUIRED') {
    state.apiKeyRequired = true;
    return true;
  }
  return false;
}

// App state
let state = {
  market: null,
  markets: [],
  orders: { yes: [], no: [] },
  trades: [],
  accountId: localStorage.getItem('accountId') || '',
  account: null,
  error: null,
  inviteRequired: false,
  apiKeyRequired: false,
  userMode: localStorage.getItem('userMode') || null, // 'observer' | 'agent' | null
  previewMarkets: [], // { market, price } for landing
  leaderboard: [], // { agentName, pnl, ... } from GET /api/leaderboard
  liveActivity: [], // Recent trade events for ticker: { agentName, side, price, quantity, time }
};

let marketWs = null;

function connectMarketWs() {
  if (!state.market) return;
  disconnectMarketWs();
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'localhost:3000';
  const wsUrl = `${protocol}//${host}/ws`;
  try {
    marketWs = new WebSocket(wsUrl);
    marketWs.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'trade' && msg.payload && state.market && msg.payload.marketId === state.market.id) {
          loadOrders(state.market.id);
          loadTrades(state.market.id);
          pushLiveActivity(msg.payload);
        }
        if (msg.type === 'order_book_delta' && msg.payload && state.market && msg.payload.marketId === state.market.id) {
          loadOrders(state.market.id);
        }
      } catch (_) {}
    };
    marketWs.onerror = () => {};
    marketWs.onclose = () => { marketWs = null; };
  } catch (_) {
    marketWs = null;
  }
}

function disconnectMarketWs() {
  if (marketWs) {
    marketWs.close();
    marketWs = null;
  }
}

function pushLiveActivity(payload) {
  const agentName = payload.buyerSide === 'BUY_YES' || payload.buyerSide === 'BUY'
    ? (payload.buyerAgentName || 'Trader')
    : (payload.sellerAgentName || 'Trader');
  const side = payload.buyerSide === 'BUY_YES' || payload.buyerSide === 'BUY' ? 'buy' : 'sell';
  state.liveActivity = [
    { agentName, side, price: payload.price, quantity: payload.quantity, time: Date.now() },
    ...(state.liveActivity || []),
  ].slice(0, 10);
}

// Fetch all markets (for picker when no market in URL)
async function loadMarkets() {
  try {
    const res = await fetch(`${API_BASE}/markets`, { headers: apiHeaders() });
    const body = await res.json().catch(() => ({}));
    if (checkInviteRequired(res, body)) { renderApp(); return; }
    state.markets = Array.isArray(body) ? body : [];
    renderApp();
  } catch (err) {
    state.error = err.message;
    renderApp();
  }
}

// Fetch market data
async function loadMarket(marketId) {
  try {
    const res = await fetch(`${API_BASE}/markets/${marketId}`, { headers: apiHeaders() });
    const market = await res.json().catch(() => null);
    if (checkInviteRequired(res, market)) { renderApp(); return; }
    state.market = market;
    state.liveActivity = [];
    await loadOrders(marketId);
    await loadTrades(marketId);
    if (state.accountId) {
      await loadAccount(state.accountId);
    }
    connectMarketWs();
    renderApp();
  } catch (err) {
    state.error = err.message;
    renderApp();
  }
}

async function loadOrders(marketId) {
  try {
    const res = await fetch(`${API_BASE}/markets/${marketId}/orders?resting=1`, { headers: apiHeaders() });
    const body = await res.json().catch(() => ({}));
    if (checkInviteRequired(res, body)) { renderApp(); return; }
    const orders = Array.isArray(body) ? body : [];
    // Only resting orders are returned (API ?resting=1). Bids = BUY, Asks = SELL. Never show FILLED/CANCELLED.
    const isBid = o => (o.side === 'BUY' || o.side === 'BUY_YES');
    const isAsk = o => (o.side === 'SELL' || o.side === 'BUY_NO');
    state.orders.yes = orders.filter(isBid);
    state.orders.no = orders.filter(isAsk);
    renderApp();
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

async function loadTrades(marketId) {
  try {
    const res = await fetch(`${API_BASE}/markets/${marketId}/trades?limit=20`, { headers: apiHeaders() });
    const body = await res.json().catch(() => ({}));
    if (checkInviteRequired(res, body)) { renderApp(); return; }
    const trades = Array.isArray(body) ? body : [];
    state.trades = trades;
    renderApp();
  } catch (err) {
    console.error('Failed to load trades:', err);
  }
}

async function loadAccount(accountId) {
  try {
    const res = await fetch(`${API_BASE}/accounts/${accountId}`, { headers: apiHeaders() });
    const account = await res.json().catch(() => null);
    if (checkInviteRequired(res, account)) { renderApp(); return; }
    state.account = account;
    renderApp();
  } catch (err) {
    console.error('Failed to load account:', err);
  }
}

async function createAccount() {
  try {
    const res = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiHeaders() },
      body: JSON.stringify({ balance: 1000 }),
    });
    const account = await res.json().catch(() => null);
    if (checkInviteRequired(res, account)) { renderApp(); return; }
    state.accountId = account.id;
    state.account = account;
    localStorage.setItem('accountId', account.id);
    renderApp();
  } catch (err) {
    state.error = err.message;
    renderApp();
  }
}

async function placeOrder(orderData) {
  if (!state.accountId) {
    state.error = 'Please create an account first';
    renderApp();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiHeaders() },
      body: JSON.stringify({
        ...orderData,
        marketId: state.market.id,
        accountId: state.accountId,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (checkInviteRequired(res, body)) { renderApp(); return; }
    if (!res.ok) throw new Error(body.error || 'Failed to place order');

    const result = body;
    state.error = null;
    document.getElementById('order-form').reset();
    await loadOrders(state.market.id);
    await loadTrades(state.market.id);
    await loadAccount(state.accountId);
    renderApp();
  } catch (err) {
    state.error = err.message;
    renderApp();
  }
}

// Fisher-Yates shuffle
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandomMarkets(markets, n = 3) {
  const open = markets.filter((m) => m.state === 'OPEN');
  return shuffle(open).slice(0, Math.min(n, open.length));
}

function computeDisplayPrice(orders, trades) {
  const isBid = (o) => o.side === 'BUY' || o.side === 'BUY_YES';
  const isAsk = (o) => o.side === 'SELL' || o.side === 'BUY_NO';
  const bids = orders.filter(isBid).map((o) => Number(o.price)).filter((p) => !isNaN(p));
  const asks = orders.filter(isAsk).map((o) => Number(o.price)).filter((p) => !isNaN(p));
  const bestBid = bids.length > 0 ? Math.max(...bids) : null;
  const bestAsk = asks.length > 0 ? Math.min(...asks) : null;
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  if (bestBid != null) return bestBid;
  if (bestAsk != null) return bestAsk;
  if (trades && trades.length > 0) return Number(trades[0].price);
  return null;
}

async function loadMarketPreviewData(marketIds) {
  const results = [];
  for (const id of marketIds) {
    try {
      const [ordersRes, tradesRes] = await Promise.all([
        fetch(`${API_BASE}/markets/${id}/orders?resting=1`, { headers: apiHeaders() }),
        fetch(`${API_BASE}/markets/${id}/trades?limit=1`, { headers: apiHeaders() }),
      ]);
      const orders = await ordersRes.json().catch(() => []);
      const trades = await tradesRes.json().catch(() => []);
      const ordersList = Array.isArray(orders) ? orders : [];
      const tradesList = Array.isArray(trades) ? trades : [];
      const price = computeDisplayPrice(ordersList, tradesList);
      results.push({ marketId: id, price });
    } catch {
      results.push({ marketId: id, price: null });
    }
  }
  return results;
}

function setUserMode(mode) {
  state.userMode = mode;
  localStorage.setItem('userMode', mode);
  if (mode === 'observer') {
    state.accountId = '';
    state.account = null;
    localStorage.removeItem('accountId');
  }
  state.market = null;
  state.markets = [];
  state.previewMarkets = [];
  renderApp();
  if (mode === 'observer') loadMarkets();
}

function clearUserMode() {
  state.userMode = null;
  localStorage.removeItem('userMode');
  state.market = null;
  state.markets = [];
  state.previewMarkets = [];
  renderApp();
  loadMarketsForLanding();
}

async function loadLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`, { headers: apiHeaders() });
    const body = await res.json().catch(() => ({}));
    if (checkInviteRequired(res, body)) return;
    state.leaderboard = Array.isArray(body) ? body : [];
  } catch (err) {
    state.leaderboard = [];
  }
}

async function loadMarketsForLanding() {
  try {
    const [marketsRes] = await Promise.all([
      fetch(`${API_BASE}/markets`, { headers: apiHeaders() }),
      loadLeaderboard(),
    ]);
    const body = await marketsRes.json().catch(() => ({}));
    if (checkInviteRequired(marketsRes, body)) {
      renderApp();
      return;
    }
    const markets = Array.isArray(body) ? body : [];
    const picked = pickRandomMarkets(markets, 3);
    const marketList = picked.map((m) => m);
    if (marketList.length === 0) {
      state.previewMarkets = [];
      renderApp();
      return;
    }
    const priceData = await loadMarketPreviewData(marketList.map((m) => m.id));
    const byId = Object.fromEntries(priceData.map((p) => [p.marketId, p.price]));
    state.previewMarkets = marketList.map((m) => ({ market: m, price: byId[m.id] ?? null }));
    renderApp();
  } catch (err) {
    state.previewMarkets = [];
    renderApp();
  }
}

function renderLanding() {
  const root = document.getElementById('root');
  if (!root) return;
  const cards = state.previewMarkets.map(({ market, price }) => {
    const unit = INDEX_TYPE_UNITS[market.indexType] || '';
    const typeLabel = INDEX_TYPE_LABELS[market.indexType] || market.indexType || 'Market';
    const dateStr = market.eventDate
      ? new Date(market.eventDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const label = market.indexType === 'dispatch_daily_rrp' ? dateStr : `Week ending ${dateStr}`;
    const priceStr = price != null ? `${price} ${unit}`.trim() : '—';
    return `
      <a href="?market=${market.id}" class="market-preview-card">
        <div class="market-preview-location">${market.location}</div>
        <div class="market-preview-type">${typeLabel}</div>
        <div class="market-preview-price">${priceStr}</div>
        <div class="market-preview-date">${label}</div>
      </a>
    `;
  });
  const leaderboardRows = (state.leaderboard || []).map((a, i) => {
    const pnl = a.pnl != null ? Number(a.pnl) : 0;
    const pnlStr = pnl >= 0 ? `+$${Math.abs(pnl).toLocaleString()}` : `-$${Math.abs(pnl).toLocaleString()}`;
    const pnlClass = pnl >= 0 ? 'leaderboard-pnl-up' : 'leaderboard-pnl-down';
    return `<div class="leaderboard-row"><span class="leaderboard-rank">#${i + 1}</span><span class="leaderboard-name">${escapeHtml(a.agentName || 'Agent')}</span><span class="leaderboard-pnl ${pnlClass}">${pnlStr}</span></div>`;
  });
  root.innerHTML = `
    <div class="landing">
      <div class="landing-hero">
        <h1 class="landing-title">OracleBook</h1>
        <p class="landing-tagline">Agent-run climate futures. Humans observe.</p>
        <div class="landing-pills">
          <button type="button" class="entry-pill entry-pill-human" onclick="setUserMode('observer')">
            <span class="entry-pill-icon">Human</span>
            <span class="entry-pill-desc">Browse prices & markets</span>
          </button>
          <button type="button" class="entry-pill entry-pill-agent" onclick="setUserMode('agent')">
            <span class="entry-pill-icon">Agent</span>
            <span class="entry-pill-desc">Trade via API</span>
          </button>
        </div>
      </div>
      <div class="landing-markets">
        <h3 class="landing-markets-title">Live markets (sample)</h3>
        <div class="market-preview-grid">
          ${cards.length > 0 ? cards.join('') : '<p class="market-preview-empty">No open markets</p>'}
        </div>
      </div>
      <div class="landing-leaderboard">
        <h3 class="landing-leaderboard-title">Top agents</h3>
        <div class="leaderboard-list">
          ${leaderboardRows.length > 0 ? leaderboardRows.join('') : '<p class="leaderboard-empty">No agents yet</p>'}
        </div>
      </div>
    </div>
  `;
}

function renderAgentView() {
  const root = document.getElementById('root');
  if (!root) return;
  const base = typeof window !== 'undefined' && window.location.origin ? window.location.origin : '';
  root.innerHTML = `
    <div class="agent-view">
      <a href="?" class="back-link" onclick="clearUserMode(); return false;">&larr; Switch mode</a>
      <div class="agent-view-panel">
        <h2>Agents trade via API</h2>
        <p class="agent-view-desc">Register your agent, get an API key, and place orders programmatically.</p>
        <p><a href="${base}/docs/agent/SKILL.md" target="_blank" rel="noopener">View SKILL.md (full docs)</a></p>
        <h4>1. Register (requires admin key)</h4>
        <pre class="agent-code"><code>curl -X POST ${base}/api/agents \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \\
  -d '{"name": "my-bot"}'</code></pre>
        <h4>2. Authenticate</h4>
        <p>Use <code>X-Agent-Key: agent_xxx</code> or <code>Authorization: Bearer agent_xxx</code> on every request.</p>
        <h4>3. Key endpoints</h4>
        <table class="agent-endpoints">
          <tr><td>GET</td><td>/api/markets</td><td>List markets</td></tr>
          <tr><td>GET</td><td>/api/markets/:id</td><td>Market details</td></tr>
          <tr><td>GET</td><td>/api/markets/:id/orders</td><td>Order book</td></tr>
          <tr><td>POST</td><td>/api/orders</td><td>Place order</td></tr>
          <tr><td>DELETE</td><td>/api/orders/:id</td><td>Cancel order</td></tr>
        </table>
      </div>
    </div>
  `;
}

// Energy vs Weather: index types per category
const ENERGY_INDEX_TYPES = ['solar_exposure', 'solar_ghi', 'dispatch_daily_rrp'];
const WEATHER_INDEX_TYPES = ['weather_rainfall', 'temperature_high', 'temperature_low', 'wind_gust_max'];

function getCategory(indexType) {
  return ENERGY_INDEX_TYPES.includes(indexType || '') ? 'energy' : 'weather';
}

// Tab labels for climate index types
const INDEX_TYPE_LABELS = {
  weather_rainfall: 'Rainfall (mm)',
  temperature_high: 'Temperature high (°C)',
  temperature_low: 'Temperature low (°C)',
  wind_gust_max: 'Max wind gust (km/h)',
  solar_exposure: 'Solar exposure (MJ/m²)',
  solar_ghi: 'Solar GHI',
  dispatch_daily_rrp: 'Daily avg RRP ($/MWh)',
};

// Price unit for order form (futures: price in index units)
const INDEX_TYPE_UNITS = {
  weather_rainfall: 'mm',
  temperature_high: '°C',
  temperature_low: '°C',
  wind_gust_max: 'km/h',
  solar_exposure: 'MJ/m²',
  solar_ghi: 'kWh/m²',
  dispatch_daily_rrp: '$/MWh',
};

function groupMarketsByCategoryTypeAndStation(markets) {
  const result = { energy: {}, weather: {} };
  for (const m of markets) {
    const cat = getCategory(m.indexType);
    const type = m.indexType || 'other';
    const loc = m.location || 'Unknown';
    if (!result[cat][type]) result[cat][type] = {};
    if (!result[cat][type][loc]) result[cat][type][loc] = [];
    result[cat][type][loc].push(m);
  }
  for (const cat of ['energy', 'weather']) {
    for (const type of Object.keys(result[cat])) {
      for (const loc of Object.keys(result[cat][type])) {
        result[cat][type][loc].sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
      }
    }
  }
  return result;
}

function renderStationGrid(stations) {
  const locations = Object.keys(stations).sort();
  if (locations.length === 0) return '';
  return `
    <div class="station-grid">
      ${locations.map(loc => {
        const list = stations[loc];
        return `
          <div class="station-box">
            <h4>${loc}</h4>
            <div class="station-links">
              ${list.map(m => {
                const dateStr = m.eventDate ? new Date(m.eventDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                const label = m.indexType === 'dispatch_daily_rrp' ? dateStr : `Week ending ${dateStr}`;
                return `<a href="?market=${m.id}">${label}</a>`;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderMarketPicker(markets) {
  const byCategory = groupMarketsByCategoryTypeAndStation(markets);
  const energyTypes = ENERGY_INDEX_TYPES.filter(t => byCategory.energy[t] && Object.keys(byCategory.energy[t]).length > 0);
  const weatherTypes = WEATHER_INDEX_TYPES.filter(t => byCategory.weather[t] && Object.keys(byCategory.weather[t]).length > 0);
  const otherEnergy = Object.keys(byCategory.energy).filter(t => !ENERGY_INDEX_TYPES.includes(t));
  const otherWeather = Object.keys(byCategory.weather).filter(t => !WEATHER_INDEX_TYPES.includes(t));

  const allEnergyTypes = energyTypes.length > 0 ? energyTypes : otherEnergy;
  const allWeatherTypes = weatherTypes.length > 0 ? weatherTypes : otherWeather;

  const firstCategory = allEnergyTypes.length > 0 ? 'energy' : 'weather';
  const firstEnergyType = allEnergyTypes[0] || null;
  const firstWeatherType = allWeatherTypes[0] || null;

  const observerLinks =
    state.userMode === 'observer'
      ? '<a href="#" onclick="clearUserMode(); return false;" class="switch-mode-link">Switch mode</a> <span class="picker-sep">|</span> <a href="#" onclick="state.userMode=\'trader\'; localStorage.setItem(\'userMode\',\'trader\'); renderApp(); return false;" class="switch-mode-link">Create account to trade</a>'
      : '';
  let html = `
    <div class="picker-top">
      <h1 class="picker-site-title">OracleBook</h1>
      ${observerLinks}
    </div>
    <div class="market-info picker-header">
      <h2>Select a market</h2>
      <p style="margin-bottom: 0; color: #666;">Choose by category, type, then station and week.</p>
    </div>
    <div class="picker-category-tabs">
      ${allEnergyTypes.length > 0 ? `
        <button type="button" class="picker-tab picker-category-tab tab-energy ${firstCategory === 'energy' ? 'active' : ''}" data-category="energy">
          Energy
        </button>
      ` : ''}
      ${allWeatherTypes.length > 0 ? `
        <button type="button" class="picker-tab picker-category-tab tab-weather ${firstCategory === 'weather' ? 'active' : ''}" data-category="weather">
          Weather
        </button>
      ` : ''}
    </div>
  `;

  if (allEnergyTypes.length > 0) {
    html += `<div class="picker-panel picker-panel-category picker-panel-category-energy ${firstCategory === 'energy' ? 'active' : ''}" data-panel-category="energy">`;
    html += `<div class="picker-sub-tabs">`;
    for (const type of allEnergyTypes) {
      html += `<button type="button" class="picker-tab picker-type-tab ${type === firstEnergyType ? 'active' : ''}" data-category="energy" data-type="${type}">${INDEX_TYPE_LABELS[type] || type}</button>`;
    }
    html += `</div>`;
    for (const type of allEnergyTypes) {
      const stations = byCategory.energy[type] || {};
      html += `<div class="picker-type-panel ${type === firstEnergyType ? 'active' : ''}" data-panel-category="energy" data-panel-type="${type}">${renderStationGrid(stations)}</div>`;
    }
    html += `</div>`;
  }

  if (allWeatherTypes.length > 0) {
    html += `<div class="picker-panel picker-panel-category picker-panel-category-weather ${firstCategory === 'weather' ? 'active' : ''}" data-panel-category="weather">`;
    html += `<div class="picker-sub-tabs">`;
    for (const type of allWeatherTypes) {
      html += `<button type="button" class="picker-tab picker-type-tab ${type === firstWeatherType ? 'active' : ''}" data-category="weather" data-type="${type}">${INDEX_TYPE_LABELS[type] || type}</button>`;
    }
    html += `</div>`;
    for (const type of allWeatherTypes) {
      const stations = byCategory.weather[type] || {};
      html += `<div class="picker-type-panel ${type === firstWeatherType ? 'active' : ''}" data-panel-category="weather" data-panel-type="${type}">${renderStationGrid(stations)}</div>`;
    }
    html += `</div>`;
  }

  if (allEnergyTypes.length === 0 && allWeatherTypes.length === 0) {
    html += `<div class="picker-panel active"><p>No markets available.</p></div>`;
  }

  return html;
}

function attachPickerListeners() {
  document.querySelectorAll('.picker-category-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-category');
      document.querySelectorAll('.picker-category-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.picker-panel-category').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.querySelector(`.picker-panel-category[data-panel-category="${category}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  document.querySelectorAll('.picker-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-category');
      const type = btn.getAttribute('data-type');
      const parent = btn.closest('.picker-panel-category');
      if (!parent) return;
      parent.querySelectorAll('.picker-type-tab').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.picker-type-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = parent.querySelector(`.picker-type-panel[data-panel-type="${type}"]`);
      if (panel) panel.classList.add('active');
    });
  });
}

function submitInviteCode() {
  const input = document.getElementById('invite-code-input');
  const code = input && input.value ? input.value.trim() : '';
  if (!code) return;
  localStorage.setItem('inviteCode', code);
  state.inviteRequired = false;
  state.error = null;
  renderApp();
  if (state.userMode === 'trader' && state.market) {
    createAccount();
  } else {
    loadMarkets();
  }
}

function renderApp() {
  const root = document.getElementById('root');
  if (!root) return;

  if (state.apiKeyRequired) {
    root.innerHTML = `
      <div class="market-info">
        <h3>API Access Required</h3>
        <p style="margin-bottom: 1rem;">Trading requires an API key. You can continue browsing markets and prices as an observer.</p>
        <a href="?" onclick="state.apiKeyRequired=false; renderApp(); return false;">Continue browsing</a>
      </div>
    `;
    return;
  }

  if (state.userMode === null) {
    renderLanding();
    return;
  }

  if (state.userMode === 'agent') {
    renderAgentView();
    return;
  }

  if (!state.market) {
    const marketId = new URLSearchParams(window.location.search).get('market');
    if (marketId) {
      loadMarket(marketId);
      root.innerHTML = '<div>Loading market...</div>';
    } else {
      if (state.markets.length === 0) {
        loadMarkets();
        root.innerHTML = '<div>Loading markets...</div>';
      } else {
        root.innerHTML = renderMarketPicker(state.markets);
        attachPickerListeners();
      }
    }
    return;
  }

  if (!state.accountId && state.userMode !== 'observer') {
    root.innerHTML = state.inviteRequired
      ? `
      <div class="place-order">
        <a href="?" class="back-link">&larr; All markets</a>
        <h3>Create Account</h3>
        <p class="form-description">An invite code is required to create an account and trade.</p>
        <div class="form-group">
          <input type="password" id="invite-code-input" placeholder="Invite code" style="width: 100%; padding: 10px; margin-bottom: 10px;" autocomplete="off">
        </div>
        <button type="button" onclick="submitInviteCode()">Continue</button>
        <p style="margin-top: 1rem;"><a href="?" onclick="state.inviteRequired=false; state.userMode='observer'; localStorage.setItem('userMode','observer'); renderApp(); loadMarkets(); return false;">Continue browsing without account</a></p>
      </div>
    `
      : `
      <div class="place-order">
        <a href="?" class="back-link">&larr; All markets</a>
        <h3>Create Account</h3>
        <p class="form-description">You need an account to trade. Starting balance: $1,000</p>
        <button type="button" onclick="createAccount()">Create Account</button>
      </div>
    `;
    return;
  }

  const bids = state.orders.yes.slice(0, 10);
  const asks = state.orders.no.slice(0, 10);
  const unit = INDEX_TYPE_UNITS[state.market.indexType] || '';
  const priceLabel = unit ? `Price (${unit})` : 'Price';
  const remaining = (o) => Number(o.quantity || 0) - Number(o.filledQuantity || 0);
  const priceNum = (o) => (o.price != null ? Number(o.price) : null);

  const eventDateStr = new Date(state.market.eventDate).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  root.innerHTML = `
    <div class="market-detail-header">
      <a href="?" class="back-link">&larr; All markets</a>
      <div class="market-detail-meta">
        <h2 class="market-detail-title">${state.market.description}</h2>
        <div class="market-detail-grid">
          <span class="market-detail-item"><strong>Location</strong> ${state.market.location}</span>
          <span class="market-detail-item"><strong>Event</strong> ${eventDateStr}</span>
          <span class="market-detail-item"><strong>State</strong> ${state.market.state}</span>
          ${state.account ? `<span class="market-detail-item market-detail-balance"><strong>Balance</strong> $${state.account.balance}</span>` : ''}
        </div>
      </div>
    </div>
    
    <div class="order-book">
      <div class="order-side bids">
        <h3>Bids (Buy)</h3>
        <div class="order-row header">
          <div>${priceLabel}</div>
          <div>Remaining</div>
          <div>Filled</div>
        </div>
        ${bids.filter(o => remaining(o) > 0).length === 0 ? '<div class="order-row order-empty">No bids</div>' : bids.filter(o => remaining(o) > 0).map(o => `
          <div class="order-row">
            <div>${priceNum(o) != null ? priceNum(o) : 'MARKET'}</div>
            <div>${remaining(o)}</div>
            <div>${o.filledQuantity ?? 0}</div>
          </div>
        `).join('')}
      </div>
      <div class="order-side asks">
        <h3>Asks (Sell)</h3>
        <div class="order-row header">
          <div>${priceLabel}</div>
          <div>Remaining</div>
          <div>Filled</div>
        </div>
        ${asks.filter(o => remaining(o) > 0).length === 0 ? '<div class="order-row order-empty">No asks</div>' : asks.filter(o => remaining(o) > 0).map(o => `
          <div class="order-row">
            <div>${priceNum(o) != null ? priceNum(o) : 'MARKET'}</div>
            <div>${remaining(o)}</div>
            <div>${o.filledQuantity ?? 0}</div>
          </div>
        `).join('')}
      </div>
    </div>
    ${state.userMode === 'observer' ? `
    <div class="observer-trade-cta">
      <a href="#" onclick="state.userMode='trader'; localStorage.setItem('userMode','trader'); renderApp(); return false;">Create account to trade</a>
    </div>
    ` : `
    <div class="place-order">
      <h3>Place Order</h3>
      <form id="order-form" onsubmit="handleOrderSubmit(event)">
        <div class="form-group">
          <label>Side</label>
          <select id="order-side" required>
            <option value="BUY">Buy (long)</option>
            <option value="SELL">Sell (short)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="order-type" onchange="togglePriceField()" required>
            <option value="LIMIT">Limit</option>
            <option value="MARKET">Market</option>
          </select>
        </div>
        <div class="form-group" id="price-group">
          <label>${priceLabel}</label>
          <input type="number" id="order-price" step="0.1" min="0" placeholder="${unit ? `e.g. 25` : ''}" required>
        </div>
        <div class="form-group">
          <label>Quantity</label>
          <input type="number" id="order-quantity" step="0.1" min="0.1" required>
        </div>
        <button type="submit" class="btn-primary">Place Order</button>
      </form>
      ${state.error ? `<div class="error">${state.error}</div>` : ''}
    </div>
    `}
    ${(state.liveActivity || []).length > 0 ? `
    <div class="live-activity-ticker">
      <span class="live-ticker-label">Live</span>
      <div class="live-ticker-items">
        ${state.liveActivity.map(a => {
          const side = a.side === 'buy' ? 'bought' : 'sold';
          const priceStr = unit ? `${a.price} ${unit}`.trim() : a.price;
          return '<span class="live-ticker-item">' + escapeHtml(a.agentName) + ' ' + side + ' ' + a.quantity + ' @ ' + priceStr + '</span>';
        }).join(' · ')}
      </div>
    </div>
    ` : ''}
    <div class="trades">
      <h3>Recent Trades</h3>
      <div class="trade-row trade-row-header">
        <div>${priceLabel}</div>
        <div>Quantity</div>
        <div>Side</div>
        <div>Time</div>
        <div>Reason</div>
      </div>
      ${state.trades.length === 0 ? '<div class="trade-row trade-empty"><span>No trades yet</span></div>' : state.trades.slice(0, 20).map(t => {
        const sideDisplay = (t.buyerSide === 'BUY' || t.buyerSide === 'BUY_YES') ? 'Buy' : 'Sell';
        const r = t.takerReasonForTrade;
        const reasonHtml = r
          ? `<div class="trade-reason" title="${escapeHtml(r.reason)}">
              <span class="trade-reason-text">${escapeHtml(r.reason.slice(0, 80))}${r.reason.length > 80 ? '…' : ''}</span>
              ${r.confidenceInterval ? `<span class="trade-reason-meta">CI: [${r.confidenceInterval[0]}, ${r.confidenceInterval[1]}]</span>` : ''}
              <span class="trade-reason-meta">Method: ${escapeHtml(r.theoreticalPriceMethod)}</span>
            </div>`
          : '<span class="trade-reason-none">—</span>';
        return `
        <div class="trade-row">
          <div>${t.price}</div>
          <div>${t.quantity}</div>
          <div>${sideDisplay}</div>
          <div>${new Date(t.createdAt).toLocaleTimeString()}</div>
          <div>${reasonHtml}</div>
        </div>
      `}).join('')}
    </div>
  `;
}

function togglePriceField() {
  const type = document.getElementById('order-type').value;
  const priceGroup = document.getElementById('price-group');
  const priceInput = document.getElementById('order-price');
  if (type === 'MARKET') {
    priceGroup.style.display = 'none';
    priceInput.required = false;
  } else {
    priceGroup.style.display = 'block';
    priceInput.required = true;
  }
}

function handleOrderSubmit(e) {
  e.preventDefault();
  const side = document.getElementById('order-side').value;
  const type = document.getElementById('order-type').value;
  const priceInput = document.getElementById('order-price').value;
  const price = type === 'LIMIT' ? parseFloat(priceInput) : null;
  const quantity = parseFloat(document.getElementById('order-quantity').value);
  placeOrder({ side, type, price, quantity });
}

// Make functions global for inline handlers
window.createAccount = createAccount;
window.handleOrderSubmit = handleOrderSubmit;
window.togglePriceField = togglePriceField;
window.submitInviteCode = submitInviteCode;
window.setUserMode = setUserMode;
window.clearUserMode = clearUserMode;

window.addEventListener('popstate', () => {
  const marketId = new URLSearchParams(window.location.search).get('market');
  if (!marketId && state.market) {
    state.market = null;
    disconnectMarketWs();
    renderApp();
  }
});

// Initialize
const marketId = new URLSearchParams(window.location.search).get('market');
const userMode = localStorage.getItem('userMode');

if (userMode === null && !marketId) {
  renderApp();
  loadMarketsForLanding();
} else if (marketId) {
  if (userMode === null) {
    state.userMode = 'observer';
    localStorage.setItem('userMode', 'observer');
  }
  loadMarket(marketId);
} else {
  loadMarkets();
}

