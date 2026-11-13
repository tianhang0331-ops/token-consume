'use strict';

const api = window.tokenConsume;

const elements = {
  dashboard: document.getElementById('dashboardView'),
  settings: document.getElementById('settingsView'),
  proxyPill: document.getElementById('proxyPill'),
  proxyStatusText: document.getElementById('proxyStatusText'),
  pinButton: document.getElementById('pinButton'),
  minimizeButton: document.getElementById('minimizeButton'),
  closeButton: document.getElementById('closeButton'),
  settingsButton: document.getElementById('settingsButton'),
  settingsBackButton: document.getElementById('settingsBackButton'),
  todayTokens: document.getElementById('todayTokens'),
  todayDate: document.getElementById('todayDate'),
  todayCost: document.getElementById('todayCost'),
  budgetBar: document.getElementById('budgetBar'),
  budgetText: document.getElementById('budgetText'),
  statRequests: document.getElementById('statRequests'),
  statInput: document.getElementById('statInput'),
  statOutput: document.getElementById('statOutput'),
  statEstimated: document.getElementById('statEstimated'),
  weekChart: document.getElementById('weekChart'),
  weekTotal: document.getElementById('weekTotal'),
  modelList: document.getElementById('modelList'),
  modelCount: document.getElementById('modelCount'),
  platformTokens: document.getElementById('platformTokens'),
  platformCost: document.getElementById('platformCost'),
  platformTime: document.getElementById('platformTime'),
  platformNote: document.getElementById('platformNote'),
  platformSyncButton: document.getElementById('platformSyncButton'),
  providerChip: document.getElementById('providerChip'),
  copyProxyButton: document.getElementById('copyProxyButton'),
  clock: document.getElementById('clock'),
  toast: document.getElementById('toast'),
  form: document.getElementById('settingsForm'),
  providerInput: document.getElementById('providerInput'),
  providerHint: document.getElementById('providerHint'),
  portInput: document.getElementById('portInput'),
  budgetInput: document.getElementById('budgetInput'),
  alwaysOnTopInput: document.getElementById('alwaysOnTopInput'),
  platformEnabledInput: document.getElementById('platformEnabledInput'),
  intervalInput: document.getElementById('intervalInput'),
  openLoginButton: document.getElementById('openLoginButton'),
  syncNowButton: document.getElementById('syncNowButton'),
  openDataButton: document.getElementById('openDataButton'),
  resetTodayButton: document.getElementById('resetTodayButton'),
  resetAllButton: document.getElementById('resetAllButton'),
  aboutLine: document.getElementById('aboutLine')
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
let currentState = null;
let toastTimer = null;

function formatTokens(value) {
  const amount = Number(value) || 0;
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e4) return `${(amount / 1e3).toFixed(1)}K`;
  return amount.toLocaleString('zh-CN');
}

function formatCny(value) {
  const amount = Number(value) || 0;
  if (amount === 0) return '¥0.00';
  if (amount < 1) return `¥${amount.toFixed(4)}`;
  return `¥${amount.toFixed(2)}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function providerOf(state, providerId) {
  const list = (state && state.providers) || [];
  return list.find((provider) => provider.id === providerId) || list[0] || null;
}

function tickClock() {
  const now = new Date();
  elements.clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
}

function openSettings() {
  elements.dashboard.hidden = true;
  elements.settings.hidden = false;
  if (currentState) fillSettingsForm(currentState);
}

function closeSettings() {
  elements.settings.hidden = true;
  elements.dashboard.hidden = false;
}

function fillSettingsForm(state) {
  const settings = state.settings;
  const providers = state.providers || [];

  elements.providerInput.innerHTML = '';
  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    elements.providerInput.append(option);
  }
  elements.providerInput.value = settings.provider;

  elements.portInput.value = String(settings.port);
  elements.budgetInput.value = String(settings.budgetCny);
  elements.alwaysOnTopInput.checked = Boolean(settings.alwaysOnTop);
  elements.platformEnabledInput.checked = Boolean(settings.platformSyncEnabled);

  const interval = String(settings.syncIntervalSeconds);
  const hasOption = [...elements.intervalInput.options].some((option) => option.value === interval);
  if (!hasOption) {
    const option = document.createElement('option');
    option.value = interval;
    option.textContent = `每 ${interval} 秒`;
    elements.intervalInput.append(option);
  }
  elements.intervalInput.value = interval;

  elements.aboutLine.textContent = `Token Consume v${state.app.version} · MIT License · 成本按内置价目表估算`;
  updateProviderHint(state);
}

function updateProviderHint(state) {
  const provider = providerOf(state, elements.providerInput.value);
  if (!provider) {
    elements.providerHint.textContent = '';
    return;
  }
  elements.providerHint.textContent = `默认模型 ${provider.defaultModel} · 上游 ${provider.apiBase} · 官方页 ${provider.usageUrl}`;
}

function renderProxy(state) {
  const proxy = state.proxy || {};
  elements.proxyPill.classList.remove('ok', 'error');
  if (proxy.running) {
    elements.proxyPill.classList.add('ok');
    elements.proxyStatusText.textContent = `代理 ${proxy.port}`;
  } else {
    elements.proxyPill.classList.add('error');
    elements.proxyStatusText.textContent = '代理未启动';
  }
  elements.copyProxyButton.textContent = proxy.baseUrl || `http://127.0.0.1:${state.settings.port}/v1`;
  elements.copyProxyButton.title = proxy.error ? `启动失败：${proxy.error}` : '复制代理地址';
}

function renderHero(state) {
  const today = (state.snapshot && state.snapshot.today) || {};
  const settings = state.settings;

  elements.todayTokens.textContent = formatTokens(today.totalTokens);
  elements.todayCost.textContent = formatCny(today.costCny);

  if (today.dateKey) {
    const date = new Date(`${today.dateKey}T00:00:00`);
    elements.todayDate.textContent = `${today.dateKey} · ${WEEKDAYS[date.getDay()]}`;
  }

  const budget = Number(settings.budgetCny) || 0;
  const cost = Number(today.costCny) || 0;
  if (budget > 0) {
    const percent = Math.min(100, (cost / budget) * 100);
    elements.budgetBar.style.width = `${percent}%`;
    elements.budgetBar.classList.toggle('over', cost > budget);
    elements.budgetText.textContent = `预算 ${formatCny(budget)} · ${percent.toFixed(0)}%`;
  } else {
    elements.budgetBar.style.width = '0%';
    elements.budgetBar.classList.remove('over');
    elements.budgetText.textContent = '未设置预算';
  }

  elements.statRequests.textContent = String(today.requests || 0);
  elements.statInput.textContent = formatTokens(today.inputTokens);
  elements.statOutput.textContent = formatTokens(today.outputTokens);
  elements.statEstimated.textContent = String(today.estimatedCount || 0);
}

function renderChart(state) {
  const days = (state.snapshot && state.snapshot.last7Days) || [];
  const max = Math.max(...days.map((day) => day.totalTokens), 1);
  const total = days.reduce((sum, day) => sum + day.totalTokens, 0);

  elements.weekTotal.textContent = `${formatTokens(total)} tokens`;
  elements.weekChart.innerHTML = '';

  for (const day of days) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-bar';
    wrapper.title = `${day.dateKey} · ${Number(day.totalTokens).toLocaleString('zh-CN')} tokens · ${formatCny(day.costCny)}`;

    const bar = document.createElement('div');
    const height = day.totalTokens > 0 ? Math.max(6, Math.round((day.totalTokens / max) * 74)) : 3;
    bar.className = day.totalTokens > 0 ? 'bar' : 'bar empty';
    bar.style.height = `${height}px`;
    wrapper.append(bar);

    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = day.label;
    wrapper.append(label);

    elements.weekChart.append(wrapper);
  }
}

function renderModels(state) {
  const models = (state.snapshot && state.snapshot.today && state.snapshot.today.models) || [];
  elements.modelCount.textContent = `${models.length} 个`;
  elements.modelList.innerHTML = '';

  if (!models.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '暂无调用记录';
    elements.modelList.append(empty);
    return;
  }

  for (const model of models.slice(0, 5)) {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = model.model;
    name.title = model.model;

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = `${formatTokens(model.totalTokens)} · ${formatCny(model.costCny)}`;

    item.append(name, value);
    elements.modelList.append(item);
  }
}

function renderPlatform(state) {
  const reading = state.platformReading;
  if (!reading) {
    elements.platformTokens.textContent = '—';
    elements.platformCost.textContent = '—';
    elements.platformTime.textContent = '尚未同步';
    elements.platformNote.textContent = '登录厂商官方页面后读取页面数字，仅作对照展示，不计入本地账本。';
    return;
  }

  const metrics = reading.metrics || {};
  elements.platformTokens.textContent = metrics.hasMetrics ? formatTokens(metrics.totalTokens) : '—';
  elements.platformCost.textContent = metrics.hasMetrics ? formatCny(metrics.costCny) : '—';
  elements.platformTime.textContent = `${formatTime(reading.capturedAt)} · ${reading.providerName || ''}`;

  if (!reading.ok) {
    elements.platformNote.textContent = `同步失败：${reading.error || '未知错误'}`;
  } else if (metrics.needsLogin) {
    elements.platformNote.textContent = '需要在官方页面登录后才能读取，请到设置中打开登录页。';
  } else if (!metrics.hasMetrics) {
    elements.platformNote.textContent = '页面已打开，但未识别到用量数字（官方页可能已改版）。';
  } else {
    elements.platformNote.textContent = '页面读数仅作对照，本地账本仍以代理计量为准。';
  }
}

function applyState(state) {
  if (!state) return;
  currentState = state;
  const provider = providerOf(state, state.settings.provider);

  elements.providerChip.textContent = provider ? provider.name : state.settings.provider;
  elements.pinButton.classList.toggle('active', Boolean(state.settings.alwaysOnTop));
  elements.pinButton.title = state.settings.alwaysOnTop ? '取消置顶' : '窗口置顶';

  renderProxy(state);
  renderHero(state);
  renderChart(state);
  renderModels(state);
  renderPlatform(state);
}

async function saveSettings() {
  const port = Number(elements.portInput.value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    showToast('端口需要是 1024 - 65535 之间的整数');
    return;
  }

  const patch = {
    provider: elements.providerInput.value,
    port,
    budgetCny: Number(elements.budgetInput.value),
    alwaysOnTop: elements.alwaysOnTopInput.checked,
    syncIntervalSeconds: Number(elements.intervalInput.value),
    platformSyncEnabled: elements.platformEnabledInput.checked
  };

  try {
    const state = await api.saveSettings(patch);
    applyState(state);
    fillSettingsForm(state);
    showToast('设置已保存');
  } catch (error) {
    showToast(`保存失败：${error.message || error}`);
  }
}

async function syncPlatform() {
  const providerId = elements.providerInput.value || currentState.settings.provider;
  elements.platformSyncButton.disabled = true;
  elements.syncNowButton.disabled = true;
  elements.syncNowButton.textContent = '同步中…';

  try {
    const result = await api.syncPlatform(providerId);
    if (result && result.ok && result.metrics && result.metrics.hasMetrics) {
      showToast('已读取官方页面用量');
    } else if (result && result.metrics && result.metrics.needsLogin) {
      showToast('请先在官方页面登录');
    } else if (result && result.ok) {
      showToast('页面已读取，但未识别到用量数字');
    } else {
      showToast(`同步失败：${(result && result.error) || '未知错误'}`);
    }
    const state = await api.getState();
    applyState(state);
  } catch (error) {
    showToast(`同步失败：${error.message || error}`);
  } finally {
    elements.platformSyncButton.disabled = false;
    elements.syncNowButton.disabled = false;
    elements.syncNowButton.textContent = '立即同步';
  }
}

async function resetUsage(scope) {
  const message = scope === 'today' ? '确定重置今日账本吗？' : '确定清空全部账本吗？此操作不可撤销。';
  if (!window.confirm(message)) return;
  const result = await api.resetUsage(scope);
  if (result && result.ok) {
    applyState(result.state);
    showToast('账本已重置');
  } else {
    showToast(`重置失败：${(result && result.error) || '未知错误'}`);
  }
}

function bindEvents() {
  elements.settingsButton.addEventListener('click', openSettings);
  elements.settingsBackButton.addEventListener('click', closeSettings);
  elements.minimizeButton.addEventListener('click', () => api.minimize());
  elements.closeButton.addEventListener('click', () => api.close());

  elements.pinButton.addEventListener('click', async () => {
    if (!currentState) return;
    const next = !currentState.settings.alwaysOnTop;
    await api.setAlwaysOnTop(next);
    currentState.settings.alwaysOnTop = next;
    elements.pinButton.classList.toggle('active', next);
    elements.pinButton.title = next ? '取消置顶' : '窗口置顶';
  });

  elements.copyProxyButton.addEventListener('click', async () => {
    if (!currentState) return;
    await api.copyText(currentState.proxy.baseUrl || `http://127.0.0.1:${currentState.settings.port}/v1`);
    showToast('代理地址已复制');
  });

  elements.platformSyncButton.addEventListener('click', syncPlatform);
  elements.syncNowButton.addEventListener('click', syncPlatform);

  elements.openLoginButton.addEventListener('click', async () => {
    const providerId = elements.providerInput.value || currentState.settings.provider;
    await api.openLogin(providerId);
    showToast('已打开官方登录页');
  });

  elements.openDataButton.addEventListener('click', () => api.openDataFolder());
  elements.resetTodayButton.addEventListener('click', () => resetUsage('today'));
  elements.resetAllButton.addEventListener('click', () => resetUsage('all'));

  elements.providerInput.addEventListener('change', () => {
    if (currentState) updateProviderHint(currentState);
  });

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.settings.hidden) closeSettings();
  });
}

async function boot() {
  if (!api) {
    showToast('未检测到 Electron 环境');
    return;
  }

  bindEvents();
  tickClock();
  setInterval(tickClock, 1000);

  try {
    const state = await api.getState();
    applyState(state);
  } catch (error) {
    showToast(`读取状态失败：${error.message || error}`);
  }

  api.onState((state) => applyState(state));
}

boot();
