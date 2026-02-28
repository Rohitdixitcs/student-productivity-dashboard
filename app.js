const STORAGE_KEYS = {
  assignments: 'spd_assignments_v1',
  studyLog: 'spd_study_log_v1',
  theme: 'spd_theme_v1',
  xp: 'spd_xp_v1',
  weeklyGoal: 'spd_weekly_goal_v1',
  lastCheckIn: 'spd_last_checkin_v1',
  notifications: 'spd_notifications_v1',
  accent: 'spd_accent_v1',
};

const PAGE_SIZE = 20;
const FOCUS_DURATION_SECONDS = 25 * 60;
const XP_PER_LEVEL = 100;

const state = {
  assignments: [],
  filteredAssignments: [],
  studyLog: {},
  chart: null,
  page: 1,
  editingAssignmentId: null,
  focusSeconds: FOCUS_DURATION_SECONDS,
  focusInterval: null,
  xp: Number(localStorage.getItem(STORAGE_KEYS.xp) || 0),
  weeklyGoal: Number(localStorage.getItem(STORAGE_KEYS.weeklyGoal) || 20),
  installPromptEvent: null,
  analyticsReady: false,
  notifications: localStorage.getItem(STORAGE_KEYS.notifications) !== 'false',
};

const $ = (id) => document.getElementById(id);

const els = {
  assignmentForm: $('assignmentForm'), assignmentTitle: $('assignmentTitle'), subjectName: $('subjectName'), deadlineDate: $('deadlineDate'),
  priorityLevel: $('priorityLevel'), assignmentSubmit: $('assignmentSubmit'), assignmentSearch: $('assignmentSearch'), assignmentFilter: $('assignmentFilter'),
  assignmentSkeleton: $('assignmentSkeleton'), assignmentList: $('assignmentList'), assignmentEmptyState: $('assignmentEmptyState'), paginationRow: $('paginationRow'),
  studyForm: $('studyForm'), studyDate: $('studyDate'), studyHours: $('studyHours'), studySubmit: $('studySubmit'),
  summaryWeekly: document.querySelector('[data-summary="weekly"]'), summaryLifetime: document.querySelector('[data-summary="lifetime"]'), summaryStreak: document.querySelector('[data-summary="streak"]'),
  statTotalAssignments: document.querySelector('[data-stat="totalAssignments"]'), statOverdueAssignments: document.querySelector('[data-stat="overdueAssignments"]'), statWeeklyHours: document.querySelector('[data-stat="weeklyHours"]'), statStreak: document.querySelector('[data-stat="streak"]'),
  progressRing: $('progressRing'), progressText: $('progressText'), timerRing: $('timerRing'), goalCard: $('goalCard'),
  focusTime: $('focusTime'), focusStart: $('focusStart'), focusReset: $('focusReset'),
  levelText: $('levelText'), xpText: $('xpText'), xpBar: $('xpBar'), levelBadge: $('levelBadge'), xpFloatLayer: $('xpFloatLayer'),
  checkInModal: $('checkInModal'), confirmCheckInBtn: $('confirmCheckInBtn'), levelUpModal: $('levelUpModal'), levelUpText: $('levelUpText'), closeLevelUpBtn: $('closeLevelUpBtn'),
  shareModal: $('shareModal'), shareCard: $('shareCard'), copyShareBtn: $('copyShareBtn'), downloadShareBtn: $('downloadShareBtn'),
  sidebar: $('sidebar'), sidebarToggle: $('sidebarToggle'), mobileAddBtn: $('mobileAddBtn'), logoutBtn: $('logoutBtn'),
  themeToggle: $('themeToggle'), toastContainer: $('toastContainer'),
  settingsForm: $('settingsForm'), weeklyGoalInput: $('weeklyGoalInput'), notificationsToggle: $('notificationsToggle'), accentColorInput: $('accentColorInput'), exportDataBtn: $('exportDataBtn'), resetDataBtn: $('resetDataBtn'),
  analytics: $('analytics'), analyticsSkeleton: $('analyticsSkeleton'), analyticsContent: $('analyticsContent'), insightsPanel: $('insightsPanel'), studyHeatmap: $('studyHeatmap'),
  installBanner: $('installBanner'), installBtn: $('installBtn'), dismissInstall: $('dismissInstall'), confettiCanvas: $('confettiCanvas'),
};

els.studyDate.value = todayISO();
els.weeklyGoalInput.value = String(state.weeklyGoal);
els.notificationsToggle.checked = state.notifications;
els.accentColorInput.value = localStorage.getItem(STORAGE_KEYS.accent) || '#6d8dff';

window.addEventListener('error', () => showToast('Something went wrong. Please refresh.', 'warning'));
window.addEventListener('unhandledrejection', () => showToast('Network/async issue occurred. Retrying may help.', 'warning'));

function todayISO() { return new Date().toISOString().split('T')[0]; }
function parseDate(s) { return new Date(`${s}T00:00:00`); }
function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }
function escapeHtml(v) { return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function debounce(fn, wait = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
function sanitizeHours(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 24 ? Number(n.toFixed(2)) : null; }

function firestoreAvailable() { return Boolean(window.firestore && window.currentUser?.uid); }
function userPath(section) { return `users/${window.currentUser?.uid || 'local'}/${section}`; }

async function syncFirestoreDoc(section, id, data) {
  if (!firestoreAvailable()) return;
  try {
    await window.firestore.doc(`${userPath(section)}/${id}`).set(data, { merge: true });
  } catch (error) { console.warn('Firestore sync failed:', error); }
}

async function fetchFirestoreCollection(section, orderByField = 'createdAt') {
  if (!firestoreAvailable()) return [];
  try {
    const snapshot = await window.firestore.collection(userPath(section)).where('userId', '==', window.currentUser.uid).orderBy(orderByField, 'desc').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Firestore fetch failed:', error);
    return [];
  }
}

function calculateDeadlineStatus(deadline) {
  const remaining = daysBetween(parseDate(todayISO()), parseDate(deadline));
  if (remaining < 0) return { className: 'overdue', label: `Overdue by ${Math.abs(remaining)} day(s)` };
  if (remaining <= 2) return { className: 'warning', label: `Due in ${remaining} day(s)` };
  return { className: 'safe', label: `${remaining} day(s) left` };
}

function showToast(message, variant = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 280);
  }, 2800);
}

function floatXP(points) {
  const node = document.createElement('div');
  node.className = 'xp-float';
  node.textContent = `+${points} XP`;
  node.style.left = `${Math.max(24, window.innerWidth - 280)}px`;
  node.style.top = '80px';
  els.xpFloatLayer.appendChild(node);
  setTimeout(() => node.remove(), 420);
}

function levelFromXp(xp) { return Math.floor(xp / XP_PER_LEVEL) + 1; }

function updateXPUI() {
  const level = levelFromXp(state.xp);
  const inLevel = state.xp % XP_PER_LEVEL;
  els.levelText.textContent = String(level);
  els.xpText.textContent = String(state.xp);
  els.xpBar.style.width = `${inLevel}%`;
  els.levelBadge.textContent = `Lvl ${level}`;
}

function launchConfetti() {
  const c = els.confettiCanvas;
  const ctx = c.getContext('2d');
  c.width = window.innerWidth; c.height = window.innerHeight;
  const particles = Array.from({ length: 80 }, () => ({ x: Math.random() * c.width, y: -20, v: 2 + Math.random() * 3, r: 3 + Math.random() * 3, color: ['#6d8dff', '#75f5c8', '#ffc06a', '#ff7676'][Math.floor(Math.random() * 4)] }));
  let frame = 0;
  const draw = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    particles.forEach((p) => { p.y += p.v; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
    frame += 1;
    if (frame < 110) requestAnimationFrame(draw); else ctx.clearRect(0, 0, c.width, c.height);
  };
  requestAnimationFrame(draw);
}

function grantXP(points, reason) {
  const old = levelFromXp(state.xp);
  state.xp += points;
  localStorage.setItem(STORAGE_KEYS.xp, String(state.xp));
  updateXPUI();
  floatXP(points);
  showToast(`⭐ ${reason}`, 'success');
  const now = levelFromXp(state.xp);
  if (now > old) {
    els.levelUpText.textContent = `You reached Level ${now}. Keep going!`;
    els.levelUpModal.classList.remove('hidden');
    launchConfetti();
  }
}

function getStudyMetrics() {
  const now = parseDate(todayISO());
  let weekly = 0; let lastWeekly = 0; let lifetime = 0;
  Object.entries(state.studyLog).forEach(([date, hrs]) => {
    const diff = daysBetween(parseDate(date), now);
    const h = Number(hrs);
    lifetime += h;
    if (diff >= 0 && diff <= 6) weekly += h;
    if (diff >= 7 && diff <= 13) lastWeekly += h;
  });

  let streak = 0;
  const cursor = parseDate(todayISO());
  while (Number(state.studyLog[cursor.toISOString().split('T')[0]]) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { weekly: +weekly.toFixed(2), lastWeekly: +lastWeekly.toFixed(2), lifetime: +lifetime.toFixed(2), streak };
}

function updateProgressRing(weekly) {
  const r = 50; const c = 2 * Math.PI * r;
  const percent = Math.min((weekly / state.weeklyGoal) * 100, 100);
  els.progressRing.style.strokeDasharray = String(c);
  els.progressRing.style.strokeDashoffset = String(c * (1 - percent / 100));
  els.progressText.textContent = `${Math.round(percent)}%`;
  els.goalCard.classList.toggle('goal-hit', percent >= 100);
}

function updateTimerRing() {
  const r = 50; const c = 2 * Math.PI * r;
  const elapsedPercent = ((FOCUS_DURATION_SECONDS - state.focusSeconds) / FOCUS_DURATION_SECONDS) * 100;
  els.timerRing.style.strokeDasharray = String(c);
  els.timerRing.style.strokeDashoffset = String(c * (1 - elapsedPercent / 100));
}

function renderHeatmap() {
  els.studyHeatmap.innerHTML = '';
  const cells = [];
  for (let i = 83; i >= 0; i -= 1) {
    const d = parseDate(todayISO());
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const h = Number(state.studyLog[key] || 0);
    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    const intensity = h === 0 ? 0.06 : Math.min(0.22 + h / 10, 0.9);
    cell.style.background = `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, rgba(255,255,255,0.06))`;
    cell.title = `${key}: ${h}h`;
    cells.push(cell);
  }
  els.studyHeatmap.append(...cells);
}

function updateInsights() {
  const metrics = getStudyMetrics();
  const overdue = state.assignments.filter((a) => !a.completed && calculateDeadlineStatus(a.deadline).className === 'overdue').length;
  const delta = metrics.lastWeekly === 0 ? 100 : ((metrics.weekly - metrics.lastWeekly) / metrics.lastWeekly) * 100;
  const trendArrow = delta >= 0 ? '↑' : '↓';

  const dayDone = new Date().getDay() + 1;
  const pace = dayDone === 0 ? 0 : metrics.weekly / dayDone;
  const projected = pace * 7;
  const achievable = projected >= state.weeklyGoal;

  const insights = [
    `${trendArrow} ${Math.abs(Math.round(delta))}% ${delta >= 0 ? 'improvement' : 'decline'} vs last week.`,
    `${achievable ? 'On track' : 'Behind pace'}: projected ${projected.toFixed(1)}h / goal ${state.weeklyGoal}h.`,
    `Overdue trend: ${overdue} active overdue assignment${overdue === 1 ? '' : 's'}.`,
  ];

  els.insightsPanel.innerHTML = insights.map((i) => `<div class="insight">💡 ${escapeHtml(i)}</div>`).join('');
}

function animateCount(el, target) {
  const start = Number(el.textContent) || 0;
  const started = performance.now();
  const duration = 300;
  const run = (now) => {
    const p = Math.min((now - started) / duration, 1);
    const v = start + (target - start) * p;
    el.textContent = Number.isInteger(target) ? Math.round(v) : v.toFixed(1);
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function updateStats() {
  const overdue = state.assignments.filter((a) => !a.completed && calculateDeadlineStatus(a.deadline).className === 'overdue').length;
  const m = getStudyMetrics();
  animateCount(els.statTotalAssignments, state.assignments.length);
  animateCount(els.statOverdueAssignments, overdue);
  animateCount(els.statWeeklyHours, m.weekly);
  animateCount(els.statStreak, m.streak);
  els.summaryWeekly.textContent = `${m.weekly}h`;
  els.summaryLifetime.textContent = `${m.lifetime}h`;
  els.summaryStreak.textContent = `${m.streak} day${m.streak === 1 ? '' : 's'}`;
  updateProgressRing(m.weekly);
  updateInsights();
  if (state.analyticsReady) renderHeatmap();
}

function renderChart() {
  if (!state.analyticsReady) return;
  const labels = []; const values = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = parseDate(todayISO()); d.setDate(d.getDate() - i);
    const k = d.toISOString().split('T')[0];
    labels.push(k.slice(5)); values.push(Number(state.studyLog[k] || 0));
  }
  const ctx = $('studyChart').getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, 'rgba(109,141,255,0.34)');
  g.addColorStop(1, 'rgba(109,141,255,0.02)');
  if (state.chart) state.chart.destroy();
  const textColor = getComputedStyle(document.body).getPropertyValue('--text').trim();
  const muted = getComputedStyle(document.body).getPropertyValue('--muted').trim();
  state.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Study Hours', data: values, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d8dff', backgroundColor: g, fill: true, tension: 0.38, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400, easing: 'easeOutQuart' }, plugins: { legend: { labels: { color: textColor } } }, scales: { x: { ticks: { color: muted }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { beginAtZero: true, ticks: { color: muted }, grid: { color: 'rgba(255,255,255,0.05)' } } } },
  });
}

function applyFilterAndSearch() {
  const query = els.assignmentSearch.value.trim().toLowerCase();
  const filter = els.assignmentFilter.value;
  state.filteredAssignments = [...state.assignments]
    .sort((a, b) => parseDate(a.deadline) - parseDate(b.deadline))
    .filter((item) => {
      const status = calculateDeadlineStatus(item.deadline);
      const q = !query || item.title.toLowerCase().includes(query) || item.subject.toLowerCase().includes(query);
      if (!q) return false;
      if (filter === 'upcoming') return !item.completed && status.className === 'warning';
      if (filter === 'overdue') return !item.completed && status.className === 'overdue';
      if (filter === 'high') return !item.completed && item.priority === 'High';
      if (filter === 'completed') return item.completed;
      return true;
    });
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.filteredAssignments.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  els.paginationRow.innerHTML = '';
  if (totalPages <= 1) return;
  const prev = document.createElement('button'); prev.className = 'btn btn-small btn-secondary'; prev.textContent = 'Prev'; prev.disabled = state.page === 1;
  const next = document.createElement('button'); next.className = 'btn btn-small btn-secondary'; next.textContent = 'Next'; next.disabled = state.page === totalPages;
  const info = document.createElement('span'); info.textContent = `Page ${state.page}/${totalPages}`;
  info.style.alignSelf = 'center';
  prev.onclick = () => { state.page -= 1; renderAssignments(); };
  next.onclick = () => { state.page += 1; renderAssignments(); };
  els.paginationRow.append(prev, info, next);
}

function renderAssignments() {
  applyFilterAndSearch();
  const start = (state.page - 1) * PAGE_SIZE;
  const view = state.filteredAssignments.slice(start, start + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  view.forEach((a) => {
    const status = calculateDeadlineStatus(a.deadline);
    const item = document.createElement('article');
    item.className = `assignment-item ${a.completed ? 'completed' : status.className}`;
    item.dataset.id = a.id;
    item.innerHTML = `<div class="assignment-main"><div><strong>${escapeHtml(a.title)}</strong><p class="assignment-meta">${escapeHtml(a.subject)} • Deadline: ${a.deadline}</p></div><span class="pill">${a.priority}</span></div><p class="assignment-meta">${a.completed ? 'Completed ✅' : status.label}</p><div class="assignment-actions"><button class="btn btn-small complete-btn" type="button">${a.completed ? 'Mark Active' : 'Mark Complete'}</button><button class="btn btn-small edit-btn" type="button">Edit</button><button class="btn btn-small btn-danger delete-btn" type="button">Delete</button></div>`;
    frag.appendChild(item);
  });

  els.assignmentList.innerHTML = '';
  els.assignmentList.appendChild(frag);
  els.assignmentEmptyState.classList.toggle('hidden', state.filteredAssignments.length > 0);
  renderPagination();
}

function saveAssignments() { localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(state.assignments)); }
function saveStudyLog() { localStorage.setItem(STORAGE_KEYS.studyLog, JSON.stringify(state.studyLog)); }

function resetAssignmentForm() {
  els.assignmentForm.reset();
  els.priorityLevel.value = 'Medium';
  state.editingAssignmentId = null;
  els.assignmentSubmit.textContent = 'Add Assignment';
  els.assignmentSubmit.disabled = true;
}

function openShareModal() {
  const m = getStudyMetrics();
  const overdue = state.assignments.filter((a) => !a.completed && calculateDeadlineStatus(a.deadline).className === 'overdue').length;
  const link = `${location.origin}${location.pathname}?share=${btoa(String(Date.now())).slice(0, 8)}`;
  els.shareCard.innerHTML = `<h4>Student Productivity Dashboard Pro</h4><p>Weekly: ${m.weekly}h • Streak: ${m.streak} days</p><p>Assignments: ${state.assignments.length} • Overdue: ${overdue}</p><p><small>${link}</small></p>`;
  els.shareCard.dataset.link = link;
  els.shareModal.classList.remove('hidden');
}

function exportData() {
  const payload = {
    assignments: state.assignments,
    studyLog: state.studyLog,
    settings: { weeklyGoal: state.weeklyGoal, notifications: state.notifications, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() },
    xp: state.xp,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'student-productivity-dashboard-data.json'; a.click();
  URL.revokeObjectURL(url);
}

async function loadData() {
  els.assignmentSkeleton.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 200));
  try {
    state.assignments = JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments) || '[]').map((a) => ({ ...a, completed: Boolean(a.completed) }));
    state.studyLog = JSON.parse(localStorage.getItem(STORAGE_KEYS.studyLog) || '{}');
  } catch {
    state.assignments = []; state.studyLog = {};
    showToast('Local data reset due to corruption.', 'warning');
  }
  els.assignmentSkeleton.classList.add('hidden');
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  els.themeToggle.textContent = theme === 'light' ? 'Toggle Dark Mode' : 'Toggle Light Mode';
  renderChart();
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  localStorage.setItem(STORAGE_KEYS.accent, color);
  renderChart();
}

async function saveWeeklyGoal(goal) {
  try {
    state.weeklyGoal = goal;
    localStorage.setItem(STORAGE_KEYS.weeklyGoal, String(goal));
    await syncFirestoreDoc('settings', 'preferences', { userId: window.currentUser?.uid || 'local', weeklyGoal: goal, updatedAt: Date.now() });
    updateStats();
    showToast('⚙️ Settings saved.', 'success');
  } catch {
    showToast('Saved locally. Cloud sync unavailable.', 'warning');
  }
}

async function addStudyHours(date, hours) {
  try {
    const safe = sanitizeHours(hours);
    if (safe === null) throw new Error('Enter valid hours (0-24).');
    const isNew = state.studyLog[date] === undefined;
    state.studyLog[date] = safe;
    saveStudyLog();
    await syncFirestoreDoc('study', date, { userId: window.currentUser?.uid || 'local', date, hours: safe, updatedAt: Date.now() });
    if (isNew) grantXP(5, 'Study entry +5 XP');
    renderChart(); updateStats();
    showToast(isNew ? 'Study entry saved.' : 'Study entry updated.', isNew ? 'success' : 'warning');
  } catch (error) { showToast(error.message, 'warning'); }
}

async function checkInToday() {
  const today = todayISO();
  const last = localStorage.getItem(STORAGE_KEYS.lastCheckIn);
  if (last === today) return;
  els.checkInModal.classList.remove('hidden');
}

function registerPWA() {
  const isSecure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && isSecure) navigator.serviceWorker.register('./service-worker.js').catch((e) => console.warn('SW register skipped', e));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    els.installBanner.classList.remove('hidden');
  });
}

function initLazyAnalytics() {
  const observer = new IntersectionObserver((entries) => {
    const hit = entries.some((e) => e.isIntersecting);
    if (!hit || state.analyticsReady) return;
    state.analyticsReady = true;
    setTimeout(() => {
      els.analyticsSkeleton.classList.add('hidden');
      els.analyticsContent.classList.remove('hidden');
      renderChart(); renderHeatmap(); updateInsights();
    }, 300);
    observer.disconnect();
  }, { threshold: 0.2 });
  observer.observe(els.analytics);
}

function setupEvents() {
  const debouncedSearch = debounce(() => { state.page = 1; renderAssignments(); }, 300);
  els.assignmentSearch.addEventListener('input', debouncedSearch);
  els.assignmentFilter.addEventListener('change', () => { state.page = 1; renderAssignments(); });

  els.assignmentForm.addEventListener('input', () => {
    const valid = els.assignmentTitle.value.trim().length >= 2 && els.subjectName.value.trim().length >= 2 && els.deadlineDate.value;
    els.assignmentSubmit.disabled = !valid;
  });

  els.assignmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = { title: els.assignmentTitle.value.trim(), subject: els.subjectName.value.trim(), deadline: els.deadlineDate.value, priority: els.priorityLevel.value };
    if (!payload.title || !payload.subject || !payload.deadline) return;
    if (state.editingAssignmentId) {
      const target = state.assignments.find((a) => a.id === state.editingAssignmentId);
      if (target) Object.assign(target, payload);
      showToast('Assignment updated.', 'success');
      await syncFirestoreDoc('assignments', state.editingAssignmentId, { userId: window.currentUser?.uid || 'local', ...payload, updatedAt: Date.now() });
    } else {
      const row = { id: crypto.randomUUID(), ...payload, completed: false, createdAt: Date.now() };
      state.assignments.push(row);
      await syncFirestoreDoc('assignments', row.id, { userId: window.currentUser?.uid || 'local', ...row });
      showToast('Assignment added.', 'success');
    }
    saveAssignments(); resetAssignmentForm(); renderAssignments(); updateStats();
  });

  els.assignmentList.addEventListener('click', async (event) => {
    const item = event.target.closest('.assignment-item');
    if (!item) return;
    const id = item.dataset.id;
    const target = state.assignments.find((a) => a.id === id);
    if (!target) return;

    if (event.target.classList.contains('delete-btn')) {
      item.classList.add('collapsing');
      setTimeout(async () => {
        state.assignments = state.assignments.filter((a) => a.id !== id);
        saveAssignments(); renderAssignments(); updateStats();
        await syncFirestoreDoc('assignments', id, { deleted: true, updatedAt: Date.now() });
      }, 220);
      return;
    }

    if (event.target.classList.contains('complete-btn')) {
      target.completed = !target.completed;
      if (target.completed) { item.classList.add('collapsing'); grantXP(10, 'Completed assignment +10 XP'); }
      saveAssignments();
      await syncFirestoreDoc('assignments', id, { completed: target.completed, updatedAt: Date.now() });
      setTimeout(() => { renderAssignments(); updateStats(); }, target.completed ? 220 : 0);
      return;
    }

    if (event.target.classList.contains('edit-btn')) {
      els.assignmentTitle.value = target.title;
      els.subjectName.value = target.subject;
      els.deadlineDate.value = target.deadline;
      els.priorityLevel.value = target.priority;
      state.editingAssignmentId = id;
      els.assignmentSubmit.textContent = 'Update Assignment';
      els.assignmentSubmit.disabled = false;
      els.assignmentTitle.focus();
    }
  });

  els.studyForm.addEventListener('input', () => { els.studySubmit.disabled = sanitizeHours(els.studyHours.value) === null || !els.studyDate.value; });
  els.studyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await addStudyHours(els.studyDate.value, els.studyHours.value);
    els.studyHours.value = '';
    els.studySubmit.disabled = true;
  });

  els.focusStart.addEventListener('click', () => {
    if (state.focusInterval) return;
    els.focusStart.disabled = true;
    els.focusStart.textContent = 'Running...';
    state.focusInterval = setInterval(() => {
      state.focusSeconds -= 1;
      const m = String(Math.floor(state.focusSeconds / 60)).padStart(2, '0');
      const s = String(state.focusSeconds % 60).padStart(2, '0');
      els.focusTime.textContent = `${m}:${s}`;
      updateTimerRing();
      if (state.focusSeconds <= 0) {
        clearInterval(state.focusInterval); state.focusInterval = null;
        state.focusSeconds = FOCUS_DURATION_SECONDS;
        els.focusTime.textContent = '25:00';
        els.focusStart.disabled = false; els.focusStart.textContent = 'Start';
        grantXP(10, 'Focus sprint complete +10 XP');
        if (confirm('Add 0.5 study hour for today?')) addStudyHours(todayISO(), Number((Number(state.studyLog[todayISO()] || 0) + 0.5).toFixed(2)));
      }
    }, 1000);
  });

  els.focusReset.addEventListener('click', () => {
    if (state.focusInterval) clearInterval(state.focusInterval);
    state.focusInterval = null;
    state.focusSeconds = FOCUS_DURATION_SECONDS;
    els.focusTime.textContent = '25:00';
    els.focusStart.disabled = false;
    els.focusStart.textContent = 'Start';
    updateTimerRing();
  });

  els.themeToggle.addEventListener('click', () => applyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light'));
  els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
  els.mobileAddBtn.addEventListener('click', () => $('assignments').scrollIntoView({ behavior: 'smooth' }));

  els.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const goal = Number(els.weeklyGoalInput.value);
    if (!goal || goal < 1 || goal > 100) return showToast('Goal must be between 1 and 100.', 'warning');
    state.notifications = els.notificationsToggle.checked;
    localStorage.setItem(STORAGE_KEYS.notifications, String(state.notifications));
    applyAccent(els.accentColorInput.value);
    await saveWeeklyGoal(goal);
  });

  els.exportDataBtn.addEventListener('click', exportData);
  els.resetDataBtn.addEventListener('click', () => {
    if (!confirm('Reset all local account data? This cannot be undone.')) return;
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });

  els.logoutBtn.addEventListener('click', (e) => { e.preventDefault(); openShareModal(); });
  els.copyShareBtn.addEventListener('click', async () => {
    const link = els.shareCard.dataset.link;
    await navigator.clipboard.writeText(link);
    showToast('Share link copied.', 'success');
  });

  els.downloadShareBtn.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 840; canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1730'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8edf8'; ctx.font = 'bold 34px Inter'; ctx.fillText('Student Productivity Dashboard Pro', 40, 80);
    ctx.font = '22px Inter';
    const m = getStudyMetrics();
    ctx.fillText(`Weekly Hours: ${m.weekly}h`, 40, 150);
    ctx.fillText(`Streak: ${m.streak} days`, 40, 190);
    ctx.fillText(`Assignments: ${state.assignments.length}`, 40, 230);
    ctx.fillText('Crafted by Rohit Dixit', 40, 300);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'dashboard-progress-card.png';
    a.click();
  });

  [els.shareModal, els.levelUpModal].forEach((modal) => {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  });
  els.closeLevelUpBtn.addEventListener('click', () => els.levelUpModal.classList.add('hidden'));

  els.confirmCheckInBtn.addEventListener('click', async () => {
    const today = todayISO();
    localStorage.setItem(STORAGE_KEYS.lastCheckIn, today);
    await syncFirestoreDoc('settings', 'checkin', { userId: window.currentUser?.uid || 'local', lastCheckIn: today, updatedAt: Date.now() });
    els.checkInModal.classList.add('hidden');
    grantXP(8, 'Daily check-in +8 XP');
  });

  els.installBtn.addEventListener('click', async () => {
    if (!state.installPromptEvent) return;
    state.installPromptEvent.prompt();
    await state.installPromptEvent.userChoice;
    els.installBanner.classList.add('hidden');
    state.installPromptEvent = null;
  });
  els.dismissInstall.addEventListener('click', () => els.installBanner.classList.add('hidden'));

  window.addEventListener('resize', debounce(() => renderChart(), 300));
}

async function init() {
  const theme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
  applyTheme(theme);
  applyAccent(localStorage.getItem(STORAGE_KEYS.accent) || '#6d8dff');

  await loadData();
  setupEvents();
  registerPWA();
  initLazyAnalytics();

  // Firestore-first reads when available; fallback to local data.
  const cloudAssignments = await fetchFirestoreCollection('assignments', 'createdAt');
  if (cloudAssignments.length) {
    state.assignments = cloudAssignments.map((a) => ({ ...a, completed: Boolean(a.completed) }));
    saveAssignments();
  }
  const cloudStudy = await fetchFirestoreCollection('study', 'date');
  if (cloudStudy.length) {
    state.studyLog = cloudStudy.reduce((acc, row) => ({ ...acc, [row.date]: Number(row.hours || 0) }), {});
    saveStudyLog();
  }

  renderAssignments();
  updateXPUI();
  updateStats();
  updateTimerRing();
  checkInToday();

  if (state.notifications) {
    state.assignments.forEach((a) => {
      if (!a.completed && calculateDeadlineStatus(a.deadline).className === 'warning') showToast(`⏰ ${a.title} is due soon.`, 'warning');
    });
  }
}

init();
