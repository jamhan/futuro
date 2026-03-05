const API_BASE = typeof window !== 'undefined' && window.location.origin
  ? window.location.origin + '/api'
  : '/api';

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
};

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
    await loadOrders(marketId);
    await loadTrades(marketId);
    if (state.accountId) {
      await loadAccount(state.accountId);
    }
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

  let html = `
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
  loadMarkets();
}

function renderApp() {
  const root = document.getElementById('root');
  if (!root) return;

  if (state.apiKeyRequired) {
    root.innerHTML = `
      <div class="market-info">
        <h3>API Access Required</h3>
        <p style="margin-bottom: 1rem;">This instance requires an API key or invite code. If you have an invite code, the operator should have set up invite-only mode.</p>
        <p style="color: var(--color-text-muted); font-size: 14px;">Contact the operator or set INVITE_SECRET for invite-only access.</p>
      </div>
    `;
    return;
  }
  if (state.inviteRequired) {
    root.innerHTML = `
      <div class="market-info" style="max-width: 400px; margin: 2rem auto;">
        <h2>Invite only</h2>
        <p style="margin-bottom: 1rem;">Enter your invite code to access the competition.</p>
        <div class="form-group">
          <input type="password" id="invite-code-input" placeholder="Invite code" style="width: 100%; padding: 10px; margin-bottom: 10px;" autocomplete="off">
        </div>
        <button type="button" onclick="submitInviteCode()">Continue</button>
      </div>
    `;
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

  if (!state.accountId) {
    root.innerHTML = `
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
    
    <div class="trades">
      <h3>Recent Trades</h3>
      <div class="trade-row trade-row-header">
        <div>${priceLabel}</div>
        <div>Quantity</div>
        <div>Side</div>
        <div>Time</div>
      </div>
      ${state.trades.length === 0 ? '<div class="trade-row trade-empty"><span>No trades yet</span></div>' : state.trades.slice(0, 20).map(t => {
        const sideDisplay = (t.buyerSide === 'BUY' || t.buyerSide === 'BUY_YES') ? 'Buy' : 'Sell';
        return `
        <div class="trade-row">
          <div>${t.price}</div>
          <div>${t.quantity}</div>
          <div>${sideDisplay}</div>
          <div>${new Date(t.createdAt).toLocaleTimeString()}</div>
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

// Initialize
const marketId = new URLSearchParams(window.location.search).get('market');
if (marketId) {
  loadMarket(marketId);
} else {
  loadMarkets();
}

