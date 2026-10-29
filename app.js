const pageTitles = {
  dashboard: 'Visão geral',
  orders: 'Pedidos',
  tables: 'Mesas e comandas',
  kitchen: 'Cozinha (KDS)',
  cashier: 'Caixa',
  menu: 'Cardápio',
  inventory: 'Estoque',
  reports: 'Relatórios',
  settings: 'Configurações'
};
const pageContent = document.querySelector('#page-content');
const dialog = document.querySelector('#app-dialog');
const authScreen = document.querySelector('#auth-screen');
const appShell = document.querySelector('#app-shell');
let currentPage = 'dashboard';
let orderSearch = '';
let orderFilter = 'all';
let reportDays = 7;
let cart = [];
let state;
let stateRevision = 0;
let authUser;
let saveQueue = Promise.resolve();

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyState(restaurantName = '') {
  return {
    restaurant: { name: restaurantName, legalName: '', cnpj: '', stateRegistration: '', phone: '', email: '', postalCode: '', address: '', number: '', complement: '', district: '', city: '', state: '', serviceChargePercent: 10 },
    menu: [], inventory: [], tables: [], orders: [], transactions: [], nextOrder: 1
  };
}

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Solicitação falhou (${response.status}).`);
    error.status = response.status;
    if (response.status === 401 && !appShell.hidden && url.startsWith('/api/state')) {
      state = null;
      authUser = null;
      renderLoginScreen(error.message);
    }
    throw error;
  }
  return body;
}

function authPage(title, subtitle, form, notice = '') {
  return `<main class="auth-card"><a class="brand auth-brand" href="/"><span class="brand-mark">M</span><span><strong>MesaFlow</strong><small>GESTÃO DO RESTAURANTE</small></span></a><h1>${escapeHtml(title)}</h1><p class="auth-subtitle">${escapeHtml(subtitle)}</p>${notice ? `<div class="notice auth-notice">${escapeHtml(notice)}</div>` : ''}${form}<div class="auth-footer">Conexão protegida · Os dados são armazenados no servidor</div></main>`;
}

function renderSetupScreen() {
  authScreen.innerHTML = authPage(
    'Configure seu restaurante',
    'Crie a conta de administrador e os dados iniciais do restaurante.',
    `<form id="setup-form"><label class="auth-label" for="setup-key">Chave de configuração</label><input class="field-input" id="setup-key" name="setupKey" type="password" autocomplete="off" required><label class="auth-label" for="setup-restaurant">Nome do restaurante</label><input class="field-input" id="setup-restaurant" name="restaurantName" maxlength="120" required placeholder="Ex.: Restaurante Central"><label class="auth-label" for="setup-name">Seu nome</label><input class="field-input" id="setup-name" name="name" maxlength="120" autocomplete="name" required><label class="auth-label" for="setup-email">E-mail</label><input class="field-input" id="setup-email" name="email" type="email" maxlength="254" autocomplete="email" required><label class="auth-label" for="setup-password">Crie uma senha (mínimo 12 caracteres)</label><input class="field-input" id="setup-password" name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required><button class="button button-primary auth-submit" type="submit">Criar conta segura</button></form>`,
    'A chave será configurada nas variáveis privadas do servidor. Não compartilhe essa chave.'
  );
  appShell.hidden = true;
  authScreen.hidden = false;
}

function renderLoginScreen(message = '') {
  authScreen.innerHTML = authPage(
    'Bem-vindo de volta',
    'Entre para acessar os dados do seu restaurante.',
    `<form id="login-form"><label class="auth-label" for="login-email">E-mail</label><input class="field-input" id="login-email" name="email" type="email" autocomplete="username" required><label class="auth-label" for="login-password">Senha</label><input class="field-input" id="login-password" name="password" type="password" autocomplete="current-password" required><button class="button button-primary auth-submit" type="submit">Entrar</button></form>`,
    message
  );
  appShell.hidden = true;
  authScreen.hidden = false;
}

function renderConnectionError(error) {
  authScreen.innerHTML = authPage('Não foi possível conectar', error.message, '<button class="button button-primary auth-submit" data-action="retry-connection">Tentar novamente</button>', 'Verifique se o servidor e o banco de dados estão disponíveis.');
  appShell.hidden = true;
  authScreen.hidden = false;
}

async function startApp() {
  authScreen.hidden = false;
  authScreen.innerHTML = authPage('Conectando ao MesaFlow', 'Verificando login e carregando dados protegidos.', '<div class="auth-loading"><span></span> Conectando ao servidor…</div>');
  appShell.hidden = true;
  try {
    const status = await apiRequest('/api/auth/status');
    if (!status.authenticated) {
      if (status.setupAvailable) {
        if (status.setupEnabled) renderSetupScreen();
        else renderConnectionError(new Error('A configuração inicial está desativada. Defina uma chave privada no servidor.'));
      } else {
        renderLoginScreen();
      }
      return;
    }
    authUser = status.user;
    const saved = await apiRequest('/api/state');
    state = saved.state;
    stateRevision = Number(saved.revision);
    authScreen.hidden = true;
    appShell.hidden = false;
    render();
  } catch (error) {
    renderConnectionError(error);
  }
}

async function saveState() {
  const snapshot = JSON.stringify(state);
  const operation = saveQueue.then(async () => {
    document.querySelector('#storage-label').textContent = 'Salvando no banco de dados…';
    const result = await apiRequest('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ revision: stateRevision, state: JSON.parse(snapshot) })
    });
    stateRevision = Number(result.revision);
    document.querySelector('#storage-label').textContent = 'Salvo no banco de dados';
    return true;
  });
  saveQueue = operation.catch(error => {
    document.querySelector('#storage-label').textContent = error.status === 409 ? 'Conflito entre sessões' : 'Falha ao salvar';
    showToast(error.message, true);
    return false;
  });
  return saveQueue;
}

async function saveOrRollback(previousState) {
  if (await saveState()) return true;
  state = previousState;
  render();
  return false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function formatTime(value) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(value));
}

function orderSubtotal(order) {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function statusLabel(status) {
  return { new: 'Novo', preparing: 'Em preparo', ready: 'Pronto', closed: 'Finalizado' }[status] || status;
}

function statusBadge(status) {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function activeOrders() {
  return state.orders.filter(order => order.status !== 'closed');
}

function getOrderForTable(tableId) {
  return activeOrders().find(order => order.tableId === tableId);
}

function getMenuItem(menuItemId) {
  return state.menu.find(item => item.id === menuItemId);
}

function menuItemCost(item) {
  return item.recipe.reduce((sum, recipeItem) => {
    const ingredient = state.inventory.find(row => row.id === recipeItem.inventoryId);
    return sum + (ingredient ? ingredient.cost * recipeItem.quantity : 0);
  }, 0);
}

function render() {
  if (!state) return;
  document.querySelector('#page-name').textContent = pageTitles[currentPage];
  document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date());
  document.querySelector('.breadcrumb > span:first-child').textContent = state.restaurant.name || 'Meu restaurante';
  document.querySelector('#restaurant-name').textContent = state.restaurant.name || 'Configurar restaurante';
  document.querySelector('#user-name').textContent = authUser.name;
  document.querySelector('#user-avatar').textContent = authUser.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.page === currentPage));
  document.querySelector('#orders-count').textContent = activeOrders().length;
  const renderers = { dashboard: renderDashboard, orders: renderOrders, tables: renderTables, kitchen: renderKitchen, cashier: renderCashier, menu: renderMenu, inventory: renderInventory, reports: renderReports, settings: renderSettings };
  pageContent.innerHTML = renderers[currentPage]();
}

function heading(title, description, action = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ''}</div>`;
}

function statCard(label, value, note, icon, positive = false) {
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><strong class="stat-value">${value}</strong><div class="stat-note ${positive ? 'positive' : ''}">${note}</div></div>`;
}

function ordersForDay(dateKey = localDateKey()) {
  return state.orders.filter(order => localDateKey(new Date(order.createdAt)) === dateKey);
}

function paidForDay(dateKey = localDateKey()) {
  return state.transactions.filter(transaction => localDateKey(new Date(transaction.createdAt)) === dateKey);
}

function renderDashboard() {
  const todayOrders = ordersForDay();
  const transactions = paidForDay();
  const revenue = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const waiting = activeOrders().filter(order => order.status === 'new').length;
  const average = transactions.length ? revenue / transactions.length : 0;
  const lowCount = state.inventory.filter(item => item.stock <= item.min).length;
  const chart = buildRevenueChart(7);
  const topItems = getTopItems(5);
  const recentOrders = [...state.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  return `${heading('Visão geral', 'Acompanhe a operação e os resultados do seu restaurante.', '<button class="button button-primary" data-action="new-order">＋ Criar pedido</button>')}
    <div class="stats-grid">
      ${statCard('Vendas de hoje', money(revenue), `${transactions.length} pagamento${transactions.length === 1 ? '' : 's'} confirmado${transactions.length === 1 ? '' : 's'}`, '↗', true)}
      ${statCard('Pedidos de hoje', String(todayOrders.length).padStart(2, '0'), `${activeOrders().length} pedido${activeOrders().length === 1 ? '' : 's'} em andamento`, '▤')}
      ${statCard('Ticket médio', money(average), 'Com base nos pagamentos registrados hoje', '◇')}
      ${statCard('Estoque baixo', String(lowCount).padStart(2, '0'), lowCount ? 'Insumos precisam de atenção' : 'Todos os insumos estão acima do mínimo', '◫', !lowCount)}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>Vendas recentes</h2><p>Valores registrados nos últimos 7 dias</p></div><span class="chart-legend"><span><i class="legend-dot"></i>Vendas</span></span></div><div class="chart-wrap"><canvas id="revenue-chart" aria-label="Gráfico de vendas dos últimos sete dias"></canvas></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Mais vendidos</h2><p>Itens de pedidos pagos</p></div><button class="text-button" data-page="reports">Ver relatórios →</button></div><div class="top-products">${topItems.length ? topItems.map((item, index) => `<div class="product-rank"><span class="rank-number">${index + 1}</span><span class="rank-copy"><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} unidade${item.quantity === 1 ? '' : 's'} vendida${item.quantity === 1 ? '' : 's'}</small></span><span class="rank-amount">${money(item.amount)}</span></div>`).join('') : '<div class="empty-state">Ainda não há vendas registradas.</div>'}</div></section>
    </div>
    <section class="table-panel"><div class="section-heading"><h2>Pedidos recentes</h2><button class="text-button" data-page="orders">Ver todos →</button></div>${ordersTable(recentOrders, false)}</section>`;
}

function buildRevenueChart(days) {
  const canvas = document.querySelector('#revenue-chart');
  if (!canvas) return;
  const width = Math.max(280, canvas.parentElement.clientWidth);
  const height = 196;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const values = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - index));
    return { key: localDateKey(date), label: new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', ''), amount: 0 };
  });
  state.transactions.forEach(transaction => {
    const point = values.find(value => value.key === localDateKey(new Date(transaction.createdAt)));
    if (point) point.amount += transaction.amount;
  });
  const max = Math.max(100, ...values.map(value => value.amount)) * 1.2;
  const left = 34, right = 10, top = 12, bottom = 25;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  context.font = '9px DM Sans, sans-serif';
  context.textBaseline = 'middle';
  for (let tick = 0; tick <= 3; tick++) {
    const y = top + chartHeight * tick / 3;
    context.strokeStyle = '#edf1ee';
    context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
    context.fillStyle = '#9aa39d';
    context.textAlign = 'left';
    context.fillText(tick === 0 ? 'R$' + Math.round(max / 1000) + 'k' : 'R$' + Math.round(max * (3 - tick) / 3), 0, y);
  }
  const points = values.map((value, index) => ({ x: left + (values.length === 1 ? 0 : chartWidth * index / (values.length - 1)), y: top + chartHeight * (1 - value.amount / max) }));
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.lineTo(points.at(-1).x, top + chartHeight);
  context.lineTo(points[0].x, top + chartHeight);
  context.closePath();
  const fill = context.createLinearGradient(0, top, 0, height);
  fill.addColorStop(0, '#4ba77530'); fill.addColorStop(1, '#4ba77500');
  context.fillStyle = fill; context.fill();
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.strokeStyle = '#29905e'; context.lineWidth = 2; context.stroke();
  points.forEach((point, index) => {
    context.beginPath(); context.arc(point.x, point.y, 3, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.strokeStyle = '#29905e'; context.lineWidth = 2; context.stroke();
    context.fillStyle = '#8d9890'; context.textAlign = index === 0 ? 'left' : (index === points.length - 1 ? 'right' : 'center');
    context.fillText(values[index].label, point.x, height - 8);
  });
}

function getTopItems(limit = 10, transactions = state.transactions) {
  const totals = new Map();
  transactions.forEach(transaction => (transaction.items || []).forEach(item => {
    const current = totals.get(item.name) || { name: item.name, quantity: 0, amount: 0 };
    current.quantity += item.quantity;
    current.amount += item.quantity * item.price;
    totals.set(item.name, current);
  }));
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

function ordersTable(orders, showActions = true) {
  if (!orders.length) return '<div class="empty-state">Nenhum pedido para exibir.</div>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Pedido</th><th>Cliente / origem</th><th>Horário</th><th>Total</th><th>Status</th>${showActions ? '<th></th>' : ''}</tr></thead><tbody>${orders.map(order => `<tr><td><strong>${escapeHtml(order.id)}</strong></td><td><strong>${escapeHtml(order.customer || 'Cliente')}</strong><br><span class="muted">${escapeHtml(order.tableId || order.channel)}</span></td><td class="nowrap">${formatTime(order.createdAt)}</td><td class="nowrap">${money(order.totalPaid ?? orderSubtotal(order))}</td><td>${statusBadge(order.status)}</td>${showActions ? `<td><button class="text-button" data-action="order-detail" data-id="${escapeHtml(order.id)}">Detalhes</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function renderOrders() {
  const orders = [...state.orders].filter(order => {
    const matchesText = `${order.id} ${order.customer} ${order.tableId} ${order.channel}`.toLowerCase().includes(orderSearch.toLowerCase());
    return matchesText && (orderFilter === 'all' || order.status === orderFilter);
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `${heading('Pedidos', 'Registre pedidos do salão, balcão e delivery em um só lugar.')}
    <div class="orders-layout">
      <section class="table-panel">
        <div class="toolbar"><div class="toolbar-left"><input class="search-input" id="order-search" placeholder="Buscar pedido ou cliente..." value="${escapeHtml(orderSearch)}"><select class="select-control" id="order-filter"><option value="all" ${orderFilter === 'all' ? 'selected' : ''}>Todos os status</option><option value="new" ${orderFilter === 'new' ? 'selected' : ''}>Novos</option><option value="preparing" ${orderFilter === 'preparing' ? 'selected' : ''}>Em preparo</option><option value="ready" ${orderFilter === 'ready' ? 'selected' : ''}>Prontos</option><option value="closed" ${orderFilter === 'closed' ? 'selected' : ''}>Finalizados</option></select></div><span class="muted">${orders.length} pedido${orders.length === 1 ? '' : 's'}</span></div>
        ${ordersTable(orders)}
      </section>
      <section class="form-panel"><h2>Novo pedido</h2><p>Adicione itens e envie direto para a cozinha.</p>${orderForm()}</section>
    </div>`;
}

function orderForm() {
  const availableMenu = state.menu.filter(item => item.active);
  const freeTables = state.tables.filter(table => !getOrderForTable(table));
  return `<form id="order-form">
    <div class="form-grid">
      <div class="form-field"><label for="order-customer">Cliente</label><input class="field-input" id="order-customer" name="customer" placeholder="Nome do cliente"></div>
      <div class="form-field"><label for="order-channel">Canal</label><select class="field-select" id="order-channel" name="channel"><option>Salão</option><option>Balcão</option><option>Delivery</option></select></div>
      <div class="form-field full" id="table-field"><label for="order-table">Mesa</label><select class="field-select" id="order-table" name="tableId"><option value="">Sem mesa</option>${freeTables.map(table => `<option>${escapeHtml(table)}</option>`).join('')}</select></div>
      <div class="form-field"><label for="item-picker">Item do cardápio</label><select class="field-select" id="item-picker"><option value="">Selecione um item</option>${availableMenu.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${money(item.price)}</option>`).join('')}</select></div>
      <div class="form-field"><label for="item-quantity">Quantidade</label><div style="display:flex;gap:7px"><input class="field-input" id="item-quantity" type="number" min="1" value="1" style="width:76px"><button class="button button-secondary" type="button" data-action="cart-add">Adicionar</button></div></div>
      <div class="form-field full"><label for="order-notes">Observação do pedido</label><input class="field-input" id="order-notes" name="notes" placeholder="Ex.: sem cebola, alergia, ponto da carne"></div>
    </div>
    <div class="cart-list" id="cart-list">${cartMarkup()}</div>
    <div class="cart-total"><span>Subtotal</span><strong id="cart-subtotal">${money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}</strong></div>
    <button class="button button-primary" type="submit" style="width:100%" ${cart.length ? '' : 'disabled'}>Enviar pedido para a cozinha</button>
  </form>`;
}

function cartMarkup() {
  if (!cart.length) return '<div class="empty-state" style="padding:17px">Adicione itens para montar o pedido.</div>';
  return cart.map((item, index) => `<div class="cart-row"><span><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} cada</small></span><span class="quantity-control"><button type="button" data-action="cart-quantity" data-index="${index}" data-delta="-1" aria-label="Diminuir">−</button><span>${item.quantity}</span><button type="button" data-action="cart-quantity" data-index="${index}" data-delta="1" aria-label="Aumentar">+</button></span><strong>${money(item.price * item.quantity)}</strong></div>`).join('');
}

function renderTables() {
  const occupied = state.tables.filter(table => getOrderForTable(table)).length;
  return `${heading('Mesas e comandas', 'Veja a ocupação do salão e acompanhe o consumo por mesa.', '<button class="button button-primary" data-action="new-order">＋ Novo pedido</button>')}
    <div class="stock-summary"><div class="summary-chip">Mesas no salão <strong>${state.tables.length}</strong></div><div class="summary-chip">Ocupadas <strong>${occupied}</strong></div><div class="summary-chip">Disponíveis <strong>${state.tables.length - occupied}</strong></div></div>
    <div class="table-grid">${state.tables.map(table => {
      const order = getOrderForTable(table);
      return `<article class="table-card ${order ? 'occupied' : ''}"><div class="table-card-top"><div><div class="table-number">${escapeHtml(table)}</div><div class="table-meta">${order ? `Pedido ${escapeHtml(order.id)}` : 'Salão'}</div></div>${order ? statusBadge(order.status) : '<span class="badge badge-ok">Disponível</span>'}</div><div class="table-card-bottom">${order ? `<div><strong>${money(orderSubtotal(order))}</strong><small>${escapeHtml(order.customer || 'Cliente')} · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} itens</small></div><button class="button button-secondary button-small" data-action="order-detail" data-id="${escapeHtml(order.id)}">Abrir</button>` : `<span class="muted">Pronta para receber cliente</span><button class="button button-primary button-small" data-action="table-order" data-table="${escapeHtml(table)}">Abrir comanda</button>`}</div></article>`;
    }).join('')}</div>`;
}

function renderKitchen() {
  const statuses = ['new', 'preparing', 'ready'];
  const titles = { new: 'Novos pedidos', preparing: 'Em preparo', ready: 'Prontos para servir' };
  const sorted = [...activeOrders()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return `${heading('Cozinha (KDS)', 'Pedidos organizados por etapa de preparo, em tempo real neste navegador.', '<span class="badge badge-ok">Atualizado agora</span>')}
    <div class="kitchen-columns">${statuses.map(status => {
      const orders = sorted.filter(order => order.status === status);
      return `<section class="kitchen-column"><div class="column-heading"><strong>${titles[status]}</strong><span class="column-count">${orders.length}</span></div>${orders.length ? orders.map(order => kitchenTicket(order)).join('') : '<div class="empty-state" style="padding:24px 7px">Nenhum pedido</div>'}</section>`;
    }).join('')}</div>`;
}

function kitchenTicket(order) {
  const nextStatus = { new: 'preparing', preparing: 'ready', ready: null }[order.status];
  const nextLabel = { new: 'Iniciar preparo', preparing: 'Marcar como pronto' }[order.status];
  return `<article class="kitchen-ticket"><div class="ticket-top"><strong>${escapeHtml(order.tableId || order.channel)} · ${escapeHtml(order.id)}</strong><span class="ticket-time">${formatTime(order.createdAt)}</span></div><div class="ticket-context">${escapeHtml(order.customer || 'Cliente')} · ${Math.max(0, Math.floor((Date.now() - new Date(order.createdAt)) / 60000))} min</div><div class="ticket-items">${order.items.map(item => `<div class="ticket-item"><strong>${item.quantity}×</strong>${escapeHtml(item.name)}${item.notes ? `<div class="ticket-note">Obs.: ${escapeHtml(item.notes)}</div>` : ''}</div>`).join('')}</div>${order.notes ? `<div class="ticket-note" style="margin:0 0 9px">Pedido: ${escapeHtml(order.notes)}</div>` : ''}<div class="ticket-actions"><button class="button button-secondary button-small" data-action="order-detail" data-id="${escapeHtml(order.id)}">Detalhes</button>${nextStatus ? `<button class="button button-primary button-small" data-action="order-status" data-id="${escapeHtml(order.id)}" data-status="${nextStatus}">${nextLabel}</button>` : ''}</div></article>`;
}

function renderCashier() {
  const openOrders = [...activeOrders()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const todayTransactions = paidForDay();
  const total = todayTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  return `${heading('Caixa', 'Feche pedidos e registre pagamentos em modo de demonstração.', '<span class="badge badge-preparing">Pagamentos simulados</span>')}
    <div class="notice">Nenhum pagamento real será processado e nenhum documento fiscal será emitido. Para produção, conecte um provedor de pagamentos e um serviço fiscal autorizado.</div>
    <div class="stats-grid">${statCard('Recebido hoje', money(total), `${todayTransactions.length} transação${todayTransactions.length === 1 ? '' : 'ões'}`, '↗', true)}${statCard('Pedidos em aberto', String(openOrders.length).padStart(2, '0'), 'Aguardando fechamento', '▤')}${statCard('Em preparo / prontos', String(openOrders.filter(order => order.status !== 'new').length).padStart(2, '0'), 'Acompanhe o status na cozinha', '◷')}${statCard('Pagamentos reais', 'Desativado', 'Modo de demonstração', '◇')}</div>
    <section class="table-panel"><div class="section-heading"><h2>Pedidos para fechar</h2><span class="muted">${openOrders.length} em aberto</span></div>${openOrders.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Pedido</th><th>Cliente / mesa</th><th>Itens</th><th>Status</th><th>Subtotal</th><th></th></tr></thead><tbody>${openOrders.map(order => `<tr><td><strong>${escapeHtml(order.id)}</strong><br><span class="muted">${formatTime(order.createdAt)}</span></td><td><strong>${escapeHtml(order.customer || 'Cliente')}</strong><br><span class="muted">${escapeHtml(order.tableId || order.channel)}</span></td><td>${order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td>${statusBadge(order.status)}</td><td class="nowrap">${money(orderSubtotal(order))}</td><td><button class="button button-primary button-small" data-action="checkout" data-id="${escapeHtml(order.id)}">Fechar conta</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Não há pedidos em aberto.</div>'}</section>
    <section class="table-panel" style="margin-top:14px"><div class="section-heading"><h2>Últimas transações</h2></div>${transactionTable([...state.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6))}</section>`;
}

function transactionTable(transactions) {
  if (!transactions.length) return '<div class="empty-state">Nenhuma transação registrada.</div>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Pedido</th><th>Data</th><th>Forma de pagamento</th><th>Valor</th></tr></thead><tbody>${transactions.map(transaction => `<tr><td><strong>${escapeHtml(transaction.orderId)}</strong></td><td>${formatDate(transaction.createdAt)} · ${formatTime(transaction.createdAt)}</td><td>${escapeHtml(transaction.paymentMethod)}</td><td><strong>${money(transaction.amount)}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

function renderMenu() {
  const categories = [...new Set(state.menu.map(item => item.category))];
  return `${heading('Cardápio', 'Gerencie itens, preços, categorias e fichas técnicas.', '<button class="button button-primary" data-action="menu-add">＋ Adicionar item</button>')}
    <div class="stock-summary"><div class="summary-chip">Itens cadastrados <strong>${state.menu.length}</strong></div><div class="summary-chip">Disponíveis <strong>${state.menu.filter(item => item.active).length}</strong></div><div class="summary-chip">Categorias <strong>${categories.length}</strong></div></div>
    <section class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Preparo</th><th>Ficha técnica</th><th>Custo estimado</th><th>Margem bruta</th><th>Preço</th><th>Status</th><th></th></tr></thead><tbody>${state.menu.map(item => {
      const cost = menuItemCost(item);
      const margin = item.price ? (item.price - cost) / item.price * 100 : 0;
      return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.prepArea)}</td><td>${item.recipe.length ? `${item.recipe.length} insumo${item.recipe.length === 1 ? '' : 's'}` : '<span class="muted">Não configurada</span>'}</td><td>${item.recipe.length ? money(cost) : '<span class="muted">—</span>'}</td><td>${item.recipe.length ? `${margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '<span class="muted">—</span>'}</td><td><strong>${money(item.price)}</strong></td><td>${item.active ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-closed">Inativo</span>'}</td><td class="nowrap"><button class="text-button" data-action="menu-edit" data-id="${escapeHtml(item.id)}">Editar</button> <button class="text-button" data-action="menu-toggle" data-id="${escapeHtml(item.id)}">${item.active ? 'Desativar' : 'Ativar'}</button></td></tr>`;
    }).join('')}</tbody></table></div></section>
    <div class="notice" style="margin-top:14px">Ficha técnica: insumos configurados são baixados automaticamente do estoque quando o pagamento demonstrativo é confirmado. Revise unidades e quantidades antes de usar em uma operação real.</div>`;
}

function renderInventory() {
  const lowStock = state.inventory.filter(item => item.stock <= item.min);
  const inventoryValue = state.inventory.reduce((sum, item) => sum + item.stock * item.cost, 0);
  return `${heading('Estoque', 'Acompanhe insumos, custos e níveis mínimos.', '<button class="button button-primary" data-action="inventory-add">＋ Adicionar insumo</button>')}
    <div class="stats-grid">${statCard('Insumos cadastrados', String(state.inventory.length).padStart(2, '0'), 'Ingredientes e produtos de consumo', '◫')}${statCard('Abaixo do mínimo', String(lowStock.length).padStart(2, '0'), lowStock.length ? 'Planeje uma reposição' : 'Estoque em nível adequado', '!', !lowStock.length)}${statCard('Valor estimado', money(inventoryValue), 'Quantidade atual × custo unitário', '◇')}${statCard('Baixas automáticas', 'Ativas', 'Aplicadas ao fechar o pedido', '↘', true)}</div>
    ${lowStock.length ? `<section class="panel low-stock-panel"><div class="panel-header" style="margin:0"><div><h2>Estoque baixo</h2><p>Os itens abaixo atingiram ou estão abaixo do mínimo definido.</p></div><span class="badge badge-low">${lowStock.length} alerta${lowStock.length === 1 ? '' : 's'}</span></div><p>${lowStock.map(item => escapeHtml(item.name)).join(' · ')}</p></section>` : ''}
    <section class="table-panel"><div class="section-heading"><h2>Insumos</h2><span class="muted">${state.inventory.length} itens</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Insumo</th><th>Quantidade atual</th><th>Mínimo</th><th>Nível</th><th>Custo unitário</th><th>Valor em estoque</th><th></th></tr></thead><tbody>${state.inventory.map(item => {
      const low = item.stock <= item.min;
      const percent = Math.max(0, Math.min(100, item.stock / (item.min * 2) * 100));
      return `<tr><td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${escapeHtml(item.unit)}</span></td><td><strong>${item.stock.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${escapeHtml(item.unit)}</strong></td><td>${item.min.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${escapeHtml(item.unit)}</td><td><span class="progress-track"><span class="progress-fill ${low ? 'low' : ''}" style="display:block;width:${percent}%"></span></span>${low ? '<span class="badge badge-low">Baixo</span>' : '<span class="badge badge-ok">Normal</span>'}</td><td>${money(item.cost)}</td><td><strong>${money(item.stock * item.cost)}</strong></td><td><button class="text-button" data-action="stock-adjust" data-id="${escapeHtml(item.id)}">Ajustar</button></td></tr>`;
    }).join('')}</tbody></table></div></section>`;
}

function renderReports() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (reportDays - 1));
  const transactions = state.transactions.filter(transaction => new Date(transaction.createdAt) >= start);
  const revenue = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const quantity = transactions.reduce((sum, transaction) => sum + (transaction.items || []).reduce((itemsSum, item) => itemsSum + item.quantity, 0), 0);
  const average = transactions.length ? revenue / transactions.length : 0;
  const topItems = getTopItems(8, transactions);
  const categories = new Map();
  transactions.forEach(transaction => (transaction.items || []).forEach(item => {
    const menuItem = getMenuItem(item.menuItemId);
    const category = menuItem?.category || 'Outros';
    categories.set(category, (categories.get(category) || 0) + item.quantity * item.price);
  }));
  const categoryRows = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(1, ...categoryRows.map(row => row[1]));
  const byMethod = new Map();
  transactions.forEach(transaction => byMethod.set(transaction.paymentMethod, (byMethod.get(transaction.paymentMethod) || 0) + transaction.amount));
  return `${heading('Relatórios', 'Resumo das vendas registradas e desempenho do cardápio.', `<div class="report-controls"><label class="muted" for="report-days">Período</label><select class="select-control" id="report-days"><option value="7" ${reportDays === 7 ? 'selected' : ''}>Últimos 7 dias</option><option value="30" ${reportDays === 30 ? 'selected' : ''}>Últimos 30 dias</option><option value="90" ${reportDays === 90 ? 'selected' : ''}>Últimos 90 dias</option></select></div>`)}
    <div class="notice">Relatórios calculados a partir dos pagamentos registrados no banco de dados. Não representam conciliação bancária real.</div>
    <div class="report-grid"><div class="panel report-card"><small>Faturamento no período</small><strong>${money(revenue)}</strong><span>${transactions.length} pagamento${transactions.length === 1 ? '' : 's'}</span></div><div class="panel report-card"><small>Ticket médio</small><strong>${money(average)}</strong><span>Por pedido pago</span></div><div class="panel report-card"><small>Itens vendidos</small><strong>${quantity}</strong><span>Unidades nos pedidos pagos</span></div></div>
    <div class="report-columns"><section class="panel"><div class="panel-header"><div><h2>Produtos mais vendidos</h2><p>Por quantidade no período</p></div></div>${topItems.length ? `<div class="bar-list">${topItems.map(item => `<div class="bar-item"><span>${escapeHtml(item.name)}</span><div class="bar-track"><div class="bar-value" style="width:${Math.max(4, item.quantity / topItems[0].quantity * 100)}%"></div></div><strong>${item.quantity} un.</strong></div>`).join('')}</div>` : '<div class="empty-state">Nenhum pagamento no período selecionado.</div>'}</section>
    <section class="panel"><div class="panel-header"><div><h2>Vendas por categoria</h2><p>Receita dos itens pagos</p></div></div>${categoryRows.length ? `<div class="bar-list">${categoryRows.map(([name, amount]) => `<div class="bar-item"><span>${escapeHtml(name)}</span><div class="bar-track"><div class="bar-value" style="width:${Math.max(4, amount / maxCategory * 100)}%"></div></div><strong>${money(amount)}</strong></div>`).join('')}</div>` : '<div class="empty-state">Sem dados disponíveis.</div>'}<div class="panel-header" style="margin:22px 0 12px"><div><h2>Formas de pagamento</h2></div></div>${byMethod.size ? `<div class="bar-list">${[...byMethod].map(([method, amount]) => `<div class="bar-item"><span>${escapeHtml(method)}</span><div class="bar-track"><div class="bar-value" style="width:${Math.max(4, amount / revenue * 100)}%"></div></div><strong>${money(amount)}</strong></div>`).join('')}</div>` : '<div class="empty-state">Sem pagamentos.</div>'}</section></div>`;
}

function renderSettings() {
  const restaurant = state.restaurant;
  const fields = [
    ['name', 'Nome do restaurante', 120, 'Ex.: Restaurante Central'],
    ['legalName', 'Razão social', 120, 'Nome empresarial'],
    ['cnpj', 'CNPJ', 18, '00.000.000/0000-00'],
    ['stateRegistration', 'Inscrição estadual', 30, ''],
    ['phone', 'Telefone', 30, '(00) 00000-0000'],
    ['email', 'E-mail do restaurante', 254, 'contato@restaurante.com.br'],
    ['postalCode', 'CEP', 9, '00000-000'],
    ['address', 'Endereço', 200, 'Rua, avenida ou rodovia'],
    ['number', 'Número', 20, ''],
    ['complement', 'Complemento', 80, 'Sala, loja, bloco'],
    ['district', 'Bairro', 80, ''],
    ['city', 'Cidade', 80, ''],
    ['state', 'UF', 2, 'SP']
  ];
  return `${heading('Configurações', 'Cadastre os dados do restaurante, mesas e acesso do administrador.')}
    <div class="settings-grid">
      <section class="form-panel"><h2>Dados do restaurante</h2><p>Essas informações podem ser usadas em relatórios e futuras integrações fiscais.</p><form id="restaurant-form"><div class="settings-fields">${fields.map(([name, label, maxLength, placeholder]) => `<div class="form-field"><label for="restaurant-${name}">${label}</label><input class="field-input" id="restaurant-${name}" name="${name}" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(restaurant[name] || '')}" ${name === 'name' ? 'required' : ''}></div>`).join('')}<div class="form-field"><label for="restaurant-service-charge">Taxa de serviço (%)</label><input class="field-input" id="restaurant-service-charge" name="serviceChargePercent" type="number" min="0" max="100" step="0.1" value="${escapeHtml(restaurant.serviceChargePercent)}"></div></div><button class="button button-primary" type="submit">Salvar dados do restaurante</button></form></section>
      <div class="settings-stack">
        <section class="form-panel"><div class="section-heading"><div><h2>Mesas do salão</h2><p class="muted">As mesas cadastradas aparecem nos novos pedidos.</p></div><button class="button button-secondary button-small" data-action="table-add">＋ Adicionar</button></div>${state.tables.length ? `<div class="settings-table-list">${state.tables.map(table => `<div class="settings-table-row"><span>${escapeHtml(table)}</span>${getOrderForTable(table) ? statusBadge(getOrderForTable(table).status) : '<span class="muted">Disponível</span>'}<button class="text-button" data-action="table-remove" data-table="${escapeHtml(table)}" ${getOrderForTable(table) ? 'disabled title="Feche a comanda antes de remover a mesa"' : ''}>Remover</button></div>`).join('')}</div>` : '<div class="empty-state">Cadastre as mesas para começar a abrir comandas do salão.</div>'}</section>
        <section class="form-panel"><h2>Alterar senha</h2><p>Use uma senha forte com pelo menos 12 caracteres.</p><form id="password-form"><div class="form-field"><label for="current-password">Senha atual</label><input class="field-input" id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="form-field"><label for="new-password">Nova senha</label><input class="field-input" id="new-password" name="newPassword" type="password" minlength="12" maxlength="72" autocomplete="new-password" required></div><button class="button button-secondary" type="submit">Alterar senha</button></form></section>
        <div class="notice">CNPJ e inscrição estadual são apenas armazenados como dados cadastrais. Este protótipo ainda não emite nota fiscal nem substitui um contador.</div>
      </div>
    </div>`;
}

async function saveRestaurant(form) {
  const data = Object.fromEntries(new FormData(form));
  const name = String(data.name || '').trim();
  const serviceChargePercent = Number(data.serviceChargePercent);
  if (!name || !Number.isFinite(serviceChargePercent) || serviceChargePercent < 0 || serviceChargePercent > 100) {
    showToast('Informe o nome do restaurante e uma taxa de serviço entre 0 e 100%.', true);
    return;
  }
  Object.keys(state.restaurant).forEach(key => {
    if (key !== 'serviceChargePercent') state.restaurant[key] = String(data[key] || '').trim();
  });
  state.restaurant.serviceChargePercent = serviceChargePercent;
  if (await saveState()) {
    render();
    showToast('Dados do restaurante salvos no banco de dados.');
  }
}

function openTableDialog() {
  openDialog(`<form id="table-form"><div class="dialog-content"><div class="dialog-header"><div><h2>Adicionar mesa</h2><p>Use um nome único, como "Mesa 01" ou "Varanda 2".</p></div><button type="button" class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="form-field"><label for="table-name">Nome da mesa</label><input class="field-input" id="table-name" name="name" maxlength="40" required></div><div class="dialog-footer"><button type="button" class="button button-secondary" data-action="dialog-close">Cancelar</button><button type="submit" class="button button-primary">Adicionar mesa</button></div></div></form>`);
}

async function saveTable(form) {
  const name = String(new FormData(form).get('name') || '').trim();
  if (!name || state.tables.some(table => table.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) return showToast('Informe um nome de mesa que ainda não esteja cadastrado.', true);
  if (state.tables.length >= 500) return showToast('O limite de 500 mesas foi atingido.', true);
  state.tables.push(name);
  if (await saveState()) {
    closeDialog();
    render();
    showToast(`${name} adicionada.`);
  }
}

async function changePassword(form) {
  const data = Object.fromEntries(new FormData(form));
  try {
    await apiRequest('/api/auth/change-password', { method: 'POST', body: JSON.stringify(data) });
    state = null;
    authUser = null;
    renderLoginScreen('Senha alterada. Entre novamente com a nova senha.');
    showToast('Senha alterada. Entre novamente.');
  } catch (error) {
    showToast(error.message, true);
  }
}

function navigate(page) {
  if (!pageTitles[page]) return;
  currentPage = page;
  document.querySelector('#sidebar').classList.remove('open');
  render();
}

function showToast(message, error = false) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  document.querySelector('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

function openDialog(content) {
  if (dialog.open) closeDialog();
  dialog.innerHTML = content;
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
  dialog.innerHTML = '';
}

function addToCart() {
  const menuItemId = document.querySelector('#item-picker')?.value;
  const quantity = Number(document.querySelector('#item-quantity')?.value);
  const item = getMenuItem(menuItemId);
  if (!item || !item.active) return showToast('Selecione um item disponível no cardápio.', true);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return showToast('Informe uma quantidade entre 1 e 99.', true);
  const existing = cart.find(row => row.menuItemId === item.id);
  if (existing) existing.quantity += quantity;
  else cart.push({ menuItemId: item.id, name: item.name, price: item.price, quantity });
  render();
  document.querySelector('#item-picker')?.focus();
}

function changeCartQuantity(index, delta) {
  const item = cart[index];
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart.splice(index, 1);
  render();
}

async function createOrder(form) {
  const formData = new FormData(form);
  if (!cart.length) return showToast('Adicione pelo menos um item ao pedido.', true);
  const channel = String(formData.get('channel'));
  const tableId = channel === 'Salão' ? String(formData.get('tableId') || '') : '';
  if (tableId && getOrderForTable(tableId)) return showToast('Esta mesa já possui uma comanda em aberto.', true);
  const previousState = structuredClone(state);
  const items = cart.map(item => ({ menuItemId: item.menuItemId, name: item.name, category: getMenuItem(item.menuItemId)?.category || 'Outros', quantity: item.quantity, price: item.price, notes: '' }));
  const order = {
    id: `P-${state.nextOrder++}`,
    customer: String(formData.get('customer') || '').trim() || 'Cliente',
    channel,
    tableId,
    status: 'new',
    items,
    notes: String(formData.get('notes') || '').trim(),
    createdAt: new Date().toISOString(),
    stockDeducted: false
  };
  state.orders.push(order);
  if (!await saveOrRollback(previousState)) return;
  cart = [];
  showToast(`Pedido ${order.id} enviado para a cozinha.`);
  render();
}

async function updateOrderStatus(orderId, status) {
  const order = state.orders.find(row => row.id === orderId);
  if (!order || !['new', 'preparing', 'ready'].includes(status)) return;
  const previousState = structuredClone(state);
  order.status = status;
  if (!await saveOrRollback(previousState)) return;
  render();
}

function showOrderDetail(orderId) {
  const order = state.orders.find(row => row.id === orderId);
  if (!order) return showToast('Pedido não encontrado.', true);
  openDialog(`<div class="dialog-content"><div class="dialog-header"><div><h2>Pedido ${escapeHtml(order.id)}</h2><p>${escapeHtml(order.customer || 'Cliente')} · ${escapeHtml(order.tableId || order.channel)} · ${formatDate(order.createdAt)} ${formatTime(order.createdAt)}</p></div><button class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="stock-summary">${statusBadge(order.status)}<span class="summary-chip">Subtotal <strong>${money(orderSubtotal(order))}</strong></span></div><div class="cart-list">${order.items.map(item => `<div class="cart-row"><span><strong>${item.quantity}× ${escapeHtml(item.name)}</strong>${item.notes ? `<small>Obs.: ${escapeHtml(item.notes)}</small>` : ''}</span><strong>${money(item.price * item.quantity)}</strong></div>`).join('')}</div>${order.notes ? `<div class="notice">${escapeHtml(order.notes)}</div>` : ''}${order.status === 'closed' ? `<div class="notice">Pagamento: ${escapeHtml(order.paymentMethod || 'Não informado')} · Total: ${money(order.totalPaid || orderSubtotal(order))}</div>` : ''}<div class="dialog-footer"><button class="button button-secondary" data-action="dialog-close">Fechar</button>${order.status !== 'closed' ? `<button class="button button-primary" data-action="checkout" data-id="${escapeHtml(order.id)}">Fechar conta</button>` : ''}</div></div>`);
}

function openCheckout(orderId) {
  const order = state.orders.find(row => row.id === orderId);
  if (!order || order.status === 'closed') return showToast('Este pedido já foi finalizado ou não existe.', true);
  const serviceRate = Number(state.restaurant.serviceChargePercent) || 0;
  const serviceEligible = order.channel === 'Salão' && serviceRate > 0;
  openDialog(`<form id="checkout-form" data-id="${escapeHtml(order.id)}"><div class="dialog-content"><div class="dialog-header"><div><h2>Fechar conta · ${escapeHtml(order.id)}</h2><p>${escapeHtml(order.customer)} · ${escapeHtml(order.tableId || order.channel)}</p></div><button type="button" class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="cart-list">${order.items.map(item => `<div class="cart-row"><span>${item.quantity}× ${escapeHtml(item.name)}</span><strong>${money(item.price * item.quantity)}</strong></div>`).join('')}</div><div class="form-grid"><div class="form-field"><label for="payment-method">Forma de pagamento</label><select class="field-select" id="payment-method" name="paymentMethod"><option>Pix (demo)</option><option>Cartão (demo)</option><option>Dinheiro (demo)</option></select></div><div class="form-field"><label for="checkout-discount">Desconto (R$)</label><input class="field-input" id="checkout-discount" name="discount" type="number" min="0" max="${orderSubtotal(order)}" step="0.01" value="0"></div><div class="form-field full"><label style="display:flex;align-items:center;gap:7px"><input type="checkbox" name="service" ${serviceEligible ? 'checked' : ''}> Incluir taxa de serviço de ${serviceRate}% ${serviceEligible ? '' : '(somente sugerida para salão)'}</label></div></div><div class="cart-total"><span>Total demonstrativo</span><strong id="checkout-total">${money(orderSubtotal(order) * (serviceEligible ? 1 + serviceRate / 100 : 1))}</strong></div><div class="notice">Transação simulada. Nenhum valor será cobrado e nenhum cupom fiscal será emitido.</div><div class="dialog-footer"><button type="button" class="button button-secondary" data-action="dialog-close">Cancelar</button><button type="submit" class="button button-primary">Confirmar pagamento demo</button></div></div></form>`);
}

async function checkout(form) {
  const orderId = form.dataset.id;
  const order = state.orders.find(row => row.id === orderId);
  if (!order || order.status === 'closed') return showToast('Este pedido já foi finalizado ou não existe.', true);
  const formData = new FormData(form);
  const subtotal = orderSubtotal(order);
  const discount = Number(formData.get('discount'));
  if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) return showToast('O desconto deve estar entre R$ 0,00 e o subtotal.', true);
  const previousState = structuredClone(state);
  const service = formData.has('service') ? subtotal * Number(state.restaurant.serviceChargePercent) / 100 : 0;
  const amount = Math.max(0, subtotal + service - discount);
  const ingredientUsage = new Map();
  order.items.forEach(orderItem => {
    const menuItem = getMenuItem(orderItem.menuItemId);
    (menuItem?.recipe || []).forEach(recipeItem => {
      const ingredient = state.inventory.find(row => row.id === recipeItem.inventoryId);
      if (ingredient) ingredientUsage.set(ingredient.id, (ingredientUsage.get(ingredient.id) || 0) + recipeItem.quantity * orderItem.quantity);
    });
  });
  const shortages = [...ingredientUsage].filter(([inventoryId, quantity]) => {
    const ingredient = state.inventory.find(row => row.id === inventoryId);
    return ingredient && ingredient.stock < quantity;
  }).map(([inventoryId]) => state.inventory.find(row => row.id === inventoryId).name);
  if (shortages.length && !window.confirm(`Estoque insuficiente para: ${[...new Set(shortages)].join(', ')}. Deseja continuar o fechamento? O saldo ficará negativo.`)) return;
  if (!order.stockDeducted) {
    ingredientUsage.forEach((quantity, inventoryId) => {
      const ingredient = state.inventory.find(row => row.id === inventoryId);
      if (ingredient) ingredient.stock = Math.round((ingredient.stock - quantity) * 1000) / 1000;
    });
  }
  const transaction = {
    id: id('T'),
    orderId: order.id,
    amount,
    paymentMethod: String(formData.get('paymentMethod')).replace(' (demo)', ''),
    createdAt: new Date().toISOString(),
    items: order.items.map(item => ({ ...item })),
    discount,
    service
  };
  order.status = 'closed';
  order.stockDeducted = true;
  order.paymentMethod = transaction.paymentMethod;
  order.totalPaid = amount;
  order.closedAt = transaction.createdAt;
  state.transactions.push(transaction);
  if (!await saveOrRollback(previousState)) return;
  closeDialog();
  showToast(`Pedido ${order.id} finalizado. Pagamento demonstrativo registrado.`);
  render();
}

function openMenuDialog(menuItem = null) {
  const editing = Boolean(menuItem);
  const item = menuItem || { id: '', name: '', category: 'Principal', price: 0, prepArea: 'Cozinha', active: true, recipe: [] };
  const recipeRows = item.recipe.length ? item.recipe : [{ inventoryId: '', quantity: '' }];
  openDialog(`<form id="menu-form" data-id="${escapeHtml(item.id)}"><div class="dialog-content"><div class="dialog-header"><div><h2>${editing ? 'Editar item' : 'Adicionar item ao cardápio'}</h2><p>Cadastre o produto e opcionalmente seus insumos para a ficha técnica.</p></div><button type="button" class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="form-grid"><div class="form-field full"><label for="menu-name">Nome do produto</label><input class="field-input" id="menu-name" name="name" required maxlength="80" value="${escapeHtml(item.name)}"></div><div class="form-field"><label for="menu-category">Categoria</label><input class="field-input" id="menu-category" name="category" required maxlength="40" value="${escapeHtml(item.category)}"></div><div class="form-field"><label for="menu-price">Preço (R$)</label><input class="field-input" id="menu-price" name="price" type="number" min="0.01" step="0.01" required value="${escapeHtml(item.price)}"></div><div class="form-field"><label for="menu-prep">Área de preparo</label><select class="field-select" id="menu-prep" name="prepArea"><option ${item.prepArea === 'Cozinha' ? 'selected' : ''}>Cozinha</option><option ${item.prepArea === 'Bar' ? 'selected' : ''}>Bar</option></select></div><div class="form-field"><label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}> Disponível para pedidos</label></div><div class="form-field full"><div style="display:flex;justify-content:space-between;align-items:center"><span class="field-label">Ficha técnica (opcional)</span><button type="button" class="text-button" data-action="recipe-add">＋ Insumo</button></div><div id="recipe-rows">${recipeRows.map(row => recipeRow(row)).join('')}</div><small class="muted">As quantidades serão descontadas quando o pedido for pago. Use a unidade cadastrada no estoque.</small></div></div><div class="dialog-footer"><button type="button" class="button button-secondary" data-action="dialog-close">Cancelar</button><button type="submit" class="button button-primary">Salvar produto</button></div></div></form>`);
}

function recipeRow(row = {}) {
  return `<div class="recipe-row"><select class="field-select" name="recipeInventory"><option value="">Selecione insumo</option>${state.inventory.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === row.inventoryId ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`).join('')}</select><input class="field-input" name="recipeQuantity" type="number" min="0.001" step="0.001" placeholder="Quantidade" value="${escapeHtml(row.quantity)}"><button type="button" class="remove-recipe" data-action="recipe-remove" aria-label="Remover insumo">×</button></div>`;
}

async function saveMenuItem(form) {
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const category = String(formData.get('category') || '').trim();
  const price = Number(formData.get('price'));
  if (!name || !category || !Number.isFinite(price) || price <= 0) return showToast('Preencha nome, categoria e preço válido.', true);
  const inventoryIds = formData.getAll('recipeInventory').map(String);
  const quantities = formData.getAll('recipeQuantity').map(Number);
  const recipe = [];
  for (let index = 0; index < inventoryIds.length; index++) {
    if (!inventoryIds[index] && !quantities[index]) continue;
    if (!state.inventory.some(item => item.id === inventoryIds[index]) || !Number.isFinite(quantities[index]) || quantities[index] <= 0) {
      return showToast('Complete corretamente cada insumo e sua quantidade ou remova a linha vazia.', true);
    }
    recipe.push({ inventoryId: inventoryIds[index], quantity: quantities[index] });
  }
  const previousState = structuredClone(state);
  const data = { name, category, price, prepArea: String(formData.get('prepArea')), active: formData.has('active'), recipe };
  if (form.dataset.id) Object.assign(state.menu.find(item => item.id === form.dataset.id), data);
  else state.menu.push({ id: id('M'), ...data });
  if (!await saveOrRollback(previousState)) return;
  closeDialog();
  showToast('Item do cardápio salvo.');
  render();
}

function openInventoryDialog() {
  openDialog(`<form id="inventory-form"><div class="dialog-content"><div class="dialog-header"><div><h2>Adicionar insumo</h2><p>Cadastre um ingrediente e seu nível mínimo.</p></div><button type="button" class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="form-grid"><div class="form-field full"><label for="inventory-name">Nome</label><input class="field-input" id="inventory-name" name="name" required maxlength="70"></div><div class="form-field"><label for="inventory-unit">Unidade</label><select class="field-select" id="inventory-unit" name="unit"><option>un</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>fatia</option></select></div><div class="form-field"><label for="inventory-stock">Quantidade inicial</label><input class="field-input" id="inventory-stock" name="stock" type="number" min="0" step="0.001" value="0" required></div><div class="form-field"><label for="inventory-min">Estoque mínimo</label><input class="field-input" id="inventory-min" name="min" type="number" min="0" step="0.001" value="0" required></div><div class="form-field"><label for="inventory-cost">Custo unitário (R$)</label><input class="field-input" id="inventory-cost" name="cost" type="number" min="0" step="0.01" value="0" required></div></div><div class="dialog-footer"><button type="button" class="button button-secondary" data-action="dialog-close">Cancelar</button><button type="submit" class="button button-primary">Salvar insumo</button></div></div></form>`);
}

async function saveInventoryItem(form) {
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const stock = Number(formData.get('stock'));
  const min = Number(formData.get('min'));
  const cost = Number(formData.get('cost'));
  if (!name || ![stock, min, cost].every(value => Number.isFinite(value) && value >= 0)) return showToast('Informe valores válidos para o insumo.', true);
  if (state.inventory.some(item => item.name.toLowerCase() === name.toLowerCase())) return showToast('Já existe um insumo com esse nome.', true);
  const previousState = structuredClone(state);
  state.inventory.push({ id: id('I'), name, unit: String(formData.get('unit')), stock, min, cost });
  if (!await saveOrRollback(previousState)) return;
  closeDialog();
  showToast('Insumo cadastrado.');
  render();
}

function adjustStock(inventoryId) {
  const item = state.inventory.find(row => row.id === inventoryId);
  if (!item) return showToast('Insumo não encontrado.', true);
  openDialog(`<form id="stock-form" data-id="${escapeHtml(item.id)}"><div class="dialog-content"><div class="dialog-header"><div><h2>Ajustar estoque</h2><p>${escapeHtml(item.name)} · saldo atual ${item.stock} ${escapeHtml(item.unit)}</p></div><button type="button" class="dialog-close" data-action="dialog-close" aria-label="Fechar">×</button></div><div class="form-field"><label for="stock-adjustment">Quantidade a adicionar ou retirar</label><input class="field-input" id="stock-adjustment" name="adjustment" type="number" step="0.001" required placeholder="Ex.: 5 para entrada ou -2 para saída"></div><div class="form-field"><label for="stock-reason">Motivo do ajuste</label><select class="field-select" id="stock-reason" name="reason"><option>Reposição</option><option>Correção de inventário</option><option>Perda ou descarte</option><option>Outro</option></select></div><div class="dialog-footer"><button type="button" class="button button-secondary" data-action="dialog-close">Cancelar</button><button type="submit" class="button button-primary">Aplicar ajuste</button></div></div></form>`);
}

async function saveStockAdjustment(form) {
  const item = state.inventory.find(row => row.id === form.dataset.id);
  const adjustment = Number(new FormData(form).get('adjustment'));
  if (!item || !Number.isFinite(adjustment) || adjustment === 0) return showToast('Informe um ajuste diferente de zero.', true);
  if (item.stock + adjustment < 0) return showToast('O ajuste não pode deixar o estoque negativo.', true);
  const previousState = structuredClone(state);
  item.stock = Math.round((item.stock + adjustment) * 1000) / 1000;
  if (!await saveOrRollback(previousState)) return;
  closeDialog();
  showToast(`Estoque de ${item.name} atualizado.`);
  render();
}

function exportData() {
  const file = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `mesaflow-backup-${localDateKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Cópia dos dados exportada.');
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-page], [data-action]');
  if (!target) return;
  if (target.dataset.page) {
    navigate(target.dataset.page);
    return;
  }
  const action = target.dataset.action;
  if (action === 'new-order') { cart = []; navigate('orders'); }
  if (action === 'export' && state) exportData();
  if (action === 'retry-connection') startApp();
  if (action === 'logout') {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      state = null;
      authUser = null;
      renderLoginScreen();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  if (action === 'cart-add') addToCart();
  if (action === 'cart-quantity') changeCartQuantity(Number(target.dataset.index), Number(target.dataset.delta));
  if (action === 'table-order') {
    cart = [];
    navigate('orders');
    const channel = document.querySelector('#order-channel');
    if (channel) { channel.value = 'Salão'; channel.dispatchEvent(new Event('change', { bubbles: true })); }
    const table = document.querySelector('#order-table');
    if (table) table.value = target.dataset.table;
  }
  if (action === 'order-status') await updateOrderStatus(target.dataset.id, target.dataset.status);
  if (action === 'order-detail') showOrderDetail(target.dataset.id);
  if (action === 'checkout') openCheckout(target.dataset.id);
  if (action === 'dialog-close') closeDialog();
  if (action === 'menu-add') openMenuDialog();
  if (action === 'menu-edit') openMenuDialog(state.menu.find(item => item.id === target.dataset.id));
  if (action === 'menu-toggle') {
    const item = state.menu.find(row => row.id === target.dataset.id);
    if (item) {
      const previousState = structuredClone(state);
      item.active = !item.active;
      if (await saveOrRollback(previousState)) {
        render();
        showToast(`Item ${item.active ? 'ativado' : 'desativado'}.`);
      }
    }
  }
  if (action === 'recipe-add') document.querySelector('#recipe-rows').insertAdjacentHTML('beforeend', recipeRow());
  if (action === 'recipe-remove') {
    const rows = document.querySelectorAll('.recipe-row');
    if (rows.length === 1) rows[0].querySelectorAll('select, input').forEach(input => { input.value = ''; });
    else target.closest('.recipe-row').remove();
  }
  if (action === 'inventory-add') openInventoryDialog();
  if (action === 'stock-adjust') adjustStock(target.dataset.id);
  if (action === 'table-add') openTableDialog();
  if (action === 'table-remove') {
    const table = target.dataset.table;
    if (getOrderForTable(table)) return showToast('Feche a comanda antes de remover esta mesa.', true);
    const previousState = structuredClone(state);
    state.tables = state.tables.filter(item => item !== table);
    if (await saveOrRollback(previousState)) {
      render();
      showToast(`${table} removida.`);
    }
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (['setup-form', 'login-form', 'order-form', 'checkout-form', 'menu-form', 'inventory-form', 'stock-form', 'restaurant-form', 'table-form', 'password-form'].includes(form.id)) event.preventDefault();
  if (form.id === 'setup-form') {
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await apiRequest('/api/auth/setup', { method: 'POST', body: JSON.stringify(data) });
      await finishAuthentication(result.user);
    } catch (error) {
      renderSetupScreen();
      showToast(error.message, true);
    }
  }
  if (form.id === 'login-form') {
    try {
      const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      await finishAuthentication(result.user);
    } catch (error) {
      renderLoginScreen(error.message);
    }
  }
  if (form.id === 'order-form') await createOrder(form);
  if (form.id === 'checkout-form') await checkout(form);
  if (form.id === 'menu-form') await saveMenuItem(form);
  if (form.id === 'inventory-form') await saveInventoryItem(form);
  if (form.id === 'stock-form') await saveStockAdjustment(form);
  if (form.id === 'restaurant-form') await saveRestaurant(form);
  if (form.id === 'table-form') await saveTable(form);
  if (form.id === 'password-form') await changePassword(form);
});

document.addEventListener('input', event => {
  if (event.target.id === 'order-search') {
    const cursor = event.target.selectionStart;
    orderSearch = event.target.value;
    render();
    const replacement = document.querySelector('#order-search');
    replacement?.focus();
    replacement?.setSelectionRange(cursor, cursor);
  }
  if (event.target.id === 'checkout-discount') updateCheckoutTotal();
});

document.addEventListener('change', event => {
  if (event.target.id === 'order-filter') { orderFilter = event.target.value; render(); }
  if (event.target.id === 'report-days') { reportDays = Number(event.target.value); render(); }
  if (event.target.id === 'order-channel') {
    const tableField = document.querySelector('#table-field');
    if (tableField) tableField.hidden = event.target.value !== 'Salão';
  }
  if (event.target.name === 'service' || event.target.id === 'checkout-discount') updateCheckoutTotal();
});

function updateCheckoutTotal() {
  const form = document.querySelector('#checkout-form');
  if (!form) return;
  const order = state.orders.find(row => row.id === form.dataset.id);
  if (!order) return;
  const formData = new FormData(form);
  const subtotal = orderSubtotal(order);
  const discount = Math.min(subtotal, Math.max(0, Number(formData.get('discount')) || 0));
  const service = formData.has('service') ? subtotal * Number(state.restaurant.serviceChargePercent) / 100 : 0;
  document.querySelector('#checkout-total').textContent = money(Math.max(0, subtotal + service - discount));
}

document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
dialog.addEventListener('click', event => {
  if (event.target === dialog) closeDialog();
});
window.addEventListener('resize', () => {
  if (currentPage === 'dashboard') buildRevenueChart(7);
});
async function finishAuthentication(user) {
  authUser = user;
  try {
    const saved = await apiRequest('/api/state');
    state = saved.state;
    stateRevision = Number(saved.revision);
    authScreen.hidden = true;
    appShell.hidden = false;
    currentPage = 'dashboard';
    render();
  } catch (error) {
    renderConnectionError(error);
  }
}

startApp();
