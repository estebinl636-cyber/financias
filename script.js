(() => {
    'use strict';

    const DATA_KEY = 'miBalanceData_v1';
    const PASSWORD_KEY = 'michiBalancePassword_v1';
    const state = {
        transactions: [], commitments: [], period: 'day', anchor: startOfDay(new Date()),
        transactionFilter: 'all', categoryFilter: 'all', toastTimer: null
    };
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const byId = id => document.getElementById(id);

    function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
    function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
    function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
    function parseDate(value) {
        if (!value) return new Date();
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    function money(value) {
        return '$' + (Number(value) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    function escapeHtml(value = '') {
        return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    }
    function makeId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }

    function saveData() {
        try {
            localStorage.setItem(DATA_KEY, JSON.stringify({ transactions: state.transactions, commitments: state.commitments }));
        } catch (error) {
            showToast('No se pudo guardar. Comprueba el espacio disponible en este navegador.');
            console.error('Error al guardar MiBalance:', error);
        }
    }

    function loadData() {
        try {
            const data = JSON.parse(localStorage.getItem(DATA_KEY) || '{}');
            state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
            state.commitments = Array.isArray(data.commitments) ? data.commitments : [];
        } catch {
            state.transactions = [];
            state.commitments = [];
        }
    }

    function exportData() {
        const backup = {
            format: 'miBalance-backup', version: 1, exportedAt: new Date().toISOString(),
            transactions: state.transactions, commitments: state.commitments
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `miBalance-respaldo-${dateKey(new Date())}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Respaldo descargado. Guárdalo para usarlo en otro navegador.');
    }

    function isValidBackup(data) {
        if (!data || data.format !== 'miBalance-backup' || data.version !== 1 || !Array.isArray(data.transactions) || !Array.isArray(data.commitments)) return false;
        const transactionIds = new Set();
        for (const item of data.transactions) {
            if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || transactionIds.has(item.id)
                || typeof item.description !== 'string' || !['income', 'expense'].includes(item.type)
                || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0
                || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return false;
            transactionIds.add(item.id);
        }
        const commitmentIds = new Set();
        for (const item of data.commitments) {
            if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || commitmentIds.has(item.id)
                || typeof item.name !== 'string' || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0
                || !Number.isInteger(Number(item.dueDay)) || Number(item.dueDay) < 1 || Number(item.dueDay) > 31
                || (item.paidMonths !== undefined && (!Array.isArray(item.paidMonths) || !item.paidMonths.every(month => typeof month === 'string')))) return false;
            commitmentIds.add(item.id);
        }
        return true;
    }

    async function importData(file) {
        if (!file) return;
        try {
            const backup = JSON.parse(await file.text());
            if (!isValidBackup(backup)) throw new Error('Formato de respaldo inválido.');
            if (!confirm(`El respaldo contiene ${backup.transactions.length} movimientos y ${backup.commitments.length} compromisos. Al importarlo se reemplazarán los datos actuales de este navegador. ¿Continuar?`)) return;
            const importedData = { transactions: backup.transactions, commitments: backup.commitments };
            localStorage.setItem(DATA_KEY, JSON.stringify(importedData));
            state.transactions = importedData.transactions;
            state.commitments = importedData.commitments;
            renderAll();
            showToast('Respaldo importado correctamente.');
        } catch (error) {
            if (error instanceof SyntaxError || error.message === 'Formato de respaldo inválido.') {
                showToast('No se pudo importar: el archivo no es un respaldo MiBalance válido.');
            } else if (error.name !== 'AbortError') {
                showToast('No se pudo importar el respaldo. Comprueba el almacenamiento disponible.');
                console.error('Error al importar MiBalance:', error);
            }
        } finally {
            byId('importDataInput').value = '';
        }
    }

    async function passwordDigest(password) {
        if (globalThis.crypto?.subtle) {
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
            return 'sha256:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        let hash = 2166136261;
        for (let index = 0; index < password.length; index++) hash = Math.imul(hash ^ password.charCodeAt(index), 16777619);
        return 'local:' + (hash >>> 0).toString(16);
    }

    function setLoginMode(mode) {
        const isSetup = mode === 'setup';
        const isRecovery = mode === 'recovery';
        byId('loginEyebrow').textContent = isSetup ? 'UN ESPACIO PARA TUS FINANZAS' : isRecovery ? 'RECUPERA TU ACCESO' : 'QUÉ BUENO TENERTE DE VUELTA';
        byId('loginTitle').innerHTML = isSetup ? 'Tu dinero,<br>más claro cada día.' : isRecovery ? 'Crea una nueva<br>contraseña.' : 'Tus finanzas te<br>están esperando.';
        byId('loginCopy').textContent = isSetup
            ? 'Crea una contraseña para mantener privado este espacio en tu dispositivo.'
            : isRecovery
                ? 'Elige una contraseña nueva. Tus movimientos se conservarán en este navegador. Esta recuperación local no verifica tu identidad.'
                : 'Escribe tu contraseña para ver tus gastos, ingresos y compromisos.';
        byId('passwordLabel').textContent = isSetup ? 'Crea una contraseña (mínimo 4 caracteres)' : isRecovery ? 'Nueva contraseña (mínimo 4 caracteres)' : 'Contraseña';
        byId('passwordInput').placeholder = isSetup || isRecovery ? 'Elige una contraseña' : 'Escribe tu contraseña';
        byId('passwordInput').autocomplete = isSetup || isRecovery ? 'new-password' : 'current-password';
        byId('passwordInput').value = '';
        byId('confirmPasswordInput').value = '';
        byId('confirmWrap').hidden = !isSetup && !isRecovery;
        byId('confirmPasswordInput').required = isSetup || isRecovery;
        byId('loginSubmit').innerHTML = isSetup ? 'Crear contraseña y entrar <span>→</span>' : isRecovery ? 'Guardar contraseña nueva <span>✓</span>' : 'Entrar a mi espacio <span>→</span>';
        byId('recoverPasswordButton').hidden = isSetup || isRecovery;
        byId('cancelRecoveryButton').hidden = !isRecovery;
        byId('loginError').textContent = '';
        byId('loginForm').dataset.mode = mode;
    }

    function unlockApp() {
        byId('loginScreen').hidden = true;
        byId('appShell').hidden = false;
        byId('todayLabel').textContent = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
        renderAll();
    }

    function initLogin() {
        setLoginMode(localStorage.getItem(PASSWORD_KEY) ? 'login' : 'setup');
        byId('loginForm').addEventListener('submit', async event => {
            event.preventDefault();
            const mode = byId('loginForm').dataset.mode;
            const isSetup = mode === 'setup';
            const isRecovery = mode === 'recovery';
            const password = byId('passwordInput').value;
            const error = byId('loginError');
            error.textContent = '';
            if (isSetup || isRecovery) {
                if (password !== byId('confirmPasswordInput').value) { error.textContent = 'Las contraseñas no coinciden.'; return; }
                localStorage.setItem(PASSWORD_KEY, await passwordDigest(password));
                loadData();
                unlockApp();
                return;
            }
            if (await passwordDigest(password) !== localStorage.getItem(PASSWORD_KEY)) {
                error.textContent = 'Esa contraseña no coincide. Inténtalo de nuevo.';
                byId('passwordInput').select();
                return;
            }
            loadData();
            unlockApp();
        });
        byId('recoverPasswordButton').addEventListener('click', () => {
            setLoginMode('recovery');
            byId('passwordInput').focus();
        });
        byId('cancelRecoveryButton').addEventListener('click', () => {
            setLoginMode('login');
            byId('passwordInput').focus();
        });
        byId('togglePassword').addEventListener('click', () => {
            const input = byId('passwordInput');
            input.type = input.type === 'password' ? 'text' : 'password';
            byId('togglePassword').setAttribute('aria-label', input.type === 'password' ? 'Mostrar contraseña' : 'Ocultar contraseña');
        });
    }

    function getPeriodRange() {
        const anchor = startOfDay(state.anchor);
        if (state.period === 'day') return { start: anchor, end: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1) };
        if (state.period === 'week') {
            const start = new Date(anchor);
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
            return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
        }
        return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
    }

    function inSelectedPeriod(item) {
        const date = parseDate(item.date);
        const { start, end } = getPeriodRange();
        return date >= start && date < end;
    }

    function periodLabel() {
        const { start, end } = getPeriodRange();
        if (state.period === 'day') return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
        if (state.period === 'week') {
            const last = new Date(end);
            last.setDate(last.getDate() - 1);
            return `${start.getDate()} – ${last.getDate()} ${new Intl.DateTimeFormat('es', { month: 'short', year: 'numeric' }).format(last)}`;
        }
        return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(start);
    }

    function movePeriod(amount) {
        if (state.period === 'day') state.anchor.setDate(state.anchor.getDate() + amount);
        if (state.period === 'week') state.anchor.setDate(state.anchor.getDate() + amount * 7);
        if (state.period === 'month') state.anchor.setMonth(state.anchor.getMonth() + amount, 1);
        renderOverview();
    }

    function renderSummary() {
        const transactions = state.transactions.filter(inSelectedPeriod);
        const income = sumType(transactions, 'income');
        const expense = sumType(transactions, 'expense');
        const currentMonthCommitments = state.commitments.filter(item => !item.paidMonths?.includes(monthKey()));
        byId('periodLabel').textContent = periodLabel();
        byId('incomeAmount').textContent = money(income);
        byId('expenseAmount').textContent = money(expense);
        byId('balanceAmount').textContent = money(income - expense);
        byId('balanceCaption').textContent = income - expense < 0 ? 'Los gastos superan los ingresos' : 'Ingresos menos gastos';
        byId('commitmentAmount').textContent = money(currentMonthCommitments.reduce((sum, item) => sum + Number(item.amount), 0));
        byId('commitmentCaption').textContent = `${currentMonthCommitments.length} ${currentMonthCommitments.length === 1 ? 'pago pendiente' : 'pagos pendientes'}`;
    }

    function sumType(items, type) { return items.filter(item => item.type === type).reduce((sum, item) => sum + Number(item.amount), 0); }

    function chartBuckets() {
        const { start, end } = getPeriodRange();
        if (state.period === 'day') {
            const buckets = Array.from({ length: 6 }, (_, index) => ({ label: `${String(index * 4).padStart(2, '0')}h`, income: 0, expense: 0 }));
            state.transactions.filter(inSelectedPeriod).forEach(item => {
                const bucket = buckets[Math.min(5, Math.floor(Number(item.hour ?? 12) / 4))];
                bucket[item.type] += Number(item.amount);
            });
            return buckets;
        }
        if (state.period === 'week') return Array.from({ length: 7 }, (_, index) => {
            const date = new Date(start);
            date.setDate(date.getDate() + index);
            const items = state.transactions.filter(item => item.date === dateKey(date));
            return { label: new Intl.DateTimeFormat('es', { weekday: 'short' }).format(date).replace('.', ''), income: sumType(items, 'income'), expense: sumType(items, 'expense') };
        });
        const days = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
        return Array.from({ length: 5 }, (_, index) => {
            const first = index * 7 + 1;
            const last = Math.min(first + 7, days + 1);
            const items = state.transactions.filter(item => {
                const date = parseDate(item.date);
                return date >= new Date(start.getFullYear(), start.getMonth(), first) && date < new Date(start.getFullYear(), start.getMonth(), last);
            });
            return { label: `${first}–${Math.min(first + 6, days)}`, income: sumType(items, 'income'), expense: sumType(items, 'expense') };
        });
    }

    function renderChart() {
        const buckets = chartBuckets();
        const max = Math.max(1, ...buckets.flatMap(item => [item.income, item.expense]));
        byId('chartSubtitle').textContent = state.period === 'day' ? 'Actividad aproximada por hora' : state.period === 'week' ? 'Ingresos y gastos por día' : 'Ingresos y gastos por semana';
        byId('activityChart').innerHTML = buckets.map(item => {
            const incomeHeight = item.income ? Math.max(5, item.income / max * 100) : 2;
            const expenseHeight = item.expense ? Math.max(5, item.expense / max * 100) : 2;
            return `<div class="chart-column" title="${escapeHtml(item.label)} · Ingresos ${money(item.income)} · Gastos ${money(item.expense)}"><div class="bar-pair"><span class="bar bar-income" style="height:${incomeHeight}%"></span><span class="bar bar-expense" style="height:${expenseHeight}%"></span></div><span class="chart-label">${escapeHtml(item.label)}</span></div>`;
        }).join('');
    }

    function renderCategories() {
        const totals = new Map();
        state.transactions.filter(item => item.type === 'expense' && inSelectedPeriod(item)).forEach(item => totals.set(item.category || 'Otro', (totals.get(item.category || 'Otro') || 0) + Number(item.amount)));
        const categories = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        const max = categories[0]?.[1] || 1;
        byId('categoryBreakdown').innerHTML = categories.length ? categories.map(([name, value]) => `<div class="category-row"><span class="category-name">${escapeHtml(name)}</span><span class="category-value">${money(value)}</span><div class="category-track"><div class="category-fill" style="width:${Math.max(5, value / max * 100)}%"></div></div></div>`).join('') : '<div class="category-empty">Todavía no hay gastos en este periodo.<br>¡Todo bajo control! ✨</div>';
    }

    function transactionMarkup(item) {
        const income = item.type === 'income';
        const date = parseDate(item.date);
        const dateText = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
        const icon = income ? '↙' : ({ 'Vivienda': '⌂', 'Servicios': 'ϟ', 'Alimentación': '◇', 'Transporte': '↗', 'Salud': '✚', 'Educación': '▤', 'Deudas': '↻', 'Suscripciones': '▣', 'Entretenimiento': '✳', 'Compras personales': '◇' }[item.category] || '•');
        const paymentDetails = item.paymentMethod ? ` · ${paymentMethodLabel(item)}${item.paymentMethod === 'credit' ? ` · ${Number(item.installments) || 1} ${Number(item.installments) === 1 ? 'cuota' : 'cuotas'}` : ''}` : '';
        return `<article class="transaction-row"><span class="transaction-icon ${income ? 'income' : ''}">${icon}</span><div class="transaction-title"><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.category || (income ? 'Ingreso' : 'Gasto'))}${item.commitmentId ? ' · Compromiso mensual' : ''}${paymentDetails}</span></div><div class="transaction-cat"><strong>${escapeHtml(item.category || '')}</strong><span>${dateText}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span></div><strong class="transaction-amount ${income ? 'income' : ''}">${income ? '+' : '−'}${money(item.amount)}</strong><button class="delete-movement" data-delete-movement="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.description)}" title="Eliminar movimiento">×</button></article>`;
    }

    function paymentMethodLabel(item) {
        return ({ cash: 'Contado', debit: 'Débito', credit: 'Tarjeta de crédito' })[item.paymentMethod] || 'Contado';
    }

    function sortedTransactions(items) {
        return [...items].sort((a, b) => `${b.date}T${String(b.hour ?? 0).padStart(2, '0')}`.localeCompare(`${a.date}T${String(a.hour ?? 0).padStart(2, '0')}`));
    }

    function renderRecent() {
        const items = sortedTransactions(state.transactions).slice(0, 5);
        byId('recentTransactions').innerHTML = items.map(transactionMarkup).join('');
        byId('recentEmpty').hidden = items.length > 0;
    }

    function renderOverview() { renderSummary(); renderChart(); renderCategories(); renderRecent(); }

    function updateCategoryFilter() {
        const selected = state.categoryFilter;
        const categories = [...new Set(state.transactions.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        byId('categoryFilter').innerHTML = '<option value="all">Todas las categorías</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
        byId('categoryFilter').value = categories.includes(selected) ? selected : 'all';
        state.categoryFilter = byId('categoryFilter').value;
    }

    function renderTransactions() {
        updateCategoryFilter();
        const items = sortedTransactions(state.transactions.filter(item => (state.transactionFilter === 'all' || item.type === state.transactionFilter) && (state.categoryFilter === 'all' || item.category === state.categoryFilter)));
        byId('allTransactions').innerHTML = items.map(transactionMarkup).join('');
        byId('allEmpty').hidden = items.length > 0;
    }

    function commitmentDueDate(item, month = new Date()) {
        const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        return new Date(month.getFullYear(), month.getMonth(), Math.min(Number(item.dueDay), lastDay));
    }

    function commitmentStatus(item, month = new Date()) {
        if (item.paidMonths?.includes(monthKey(month))) return 'paid';
        const due = commitmentDueDate(item, month);
        return startOfDay(due) < startOfDay(new Date()) ? 'overdue' : 'pending';
    }

    function renderCommitments() {
        const month = new Date();
        const pending = state.commitments.filter(item => !item.paidMonths?.includes(monthKey(month)));
        const total = state.commitments.reduce((sum, item) => sum + Number(item.amount), 0);
        const pendingTotal = pending.reduce((sum, item) => sum + Number(item.amount), 0);
        const paidCount = state.commitments.length - pending.length;
        byId('commitmentSummary').innerHTML = `<article class="commitment-summary-card"><span>Total comprometido este mes</span><strong>${money(total)}</strong></article><article class="commitment-summary-card"><span>Pendiente de pago</span><strong>${money(pendingTotal)}</strong></article><article class="commitment-summary-card"><span>Pagos completados</span><strong>${paidCount} <small>de ${state.commitments.length}</small></strong></article>`;
        byId('commitmentsEmpty').hidden = state.commitments.length > 0;
        byId('commitmentsList').innerHTML = state.commitments.map(item => {
            const status = commitmentStatus(item, month);
            const due = commitmentDueDate(item, month);
            const statusLabel = status === 'paid' ? 'Pagado este mes' : status === 'overdue' ? 'Vencido' : 'Pendiente';
            const dueLabel = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(due);
            const badge = status === 'paid' ? 'status-paid' : status === 'overdue' ? 'status-overdue' : 'status-pending';
            return `<article class="commitment-card"><span class="commitment-icon">${commitmentIcon(item.category)}</span><div class="commitment-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} · Vence el ${dueLabel}</span>${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}</div><div class="commitment-amount"><strong>${money(item.amount)}</strong><span class="commitment-status ${badge}">${statusLabel}</span></div><div class="commitment-actions"><button class="button ${status === 'paid' ? 'button-soft' : 'button-primary'} mark-paid" data-toggle-payment="${escapeHtml(item.id)}">${status === 'paid' ? '↶ Deshacer' : '✓ Marcar pagado'}</button><button class="remove-commitment" data-delete-commitment="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.name)}" title="Eliminar compromiso">×</button></div></article>`;
        }).join('');
    }

    function commitmentIcon(category) {
        return ({ 'Vivienda': '⌂', 'Servicios': 'ϟ', 'Deudas': '↻', 'Suscripciones': '▣', 'Salud': '✚', 'Educación': '▤' }[category] || '▣');
    }

    function renderAll() { renderOverview(); renderTransactions(); renderCommitments(); }

    function showToast(message) {
        const toast = byId('toast');
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
    }

    function openMovementModal() {
        byId('movementForm').reset();
        byId('movementDate').value = dateKey(new Date());
        byId('movementType').value = 'expense';
        updateInstallmentField();
        $$('.type-option').forEach(button => button.classList.toggle('active', button.dataset.type === 'expense'));
        byId('movementModal').hidden = false;
        byId('movementDescription').focus();
    }

    function updateInstallmentField() {
        const isCredit = byId('movementPaymentMethod').value === 'credit';
        byId('installmentField').hidden = !isCredit;
        byId('movementInstallments').required = isCredit;
    }
    function closeMovementModal() { byId('movementModal').hidden = true; }
    function openCommitmentModal() { byId('commitmentForm').reset(); byId('commitmentModal').hidden = false; byId('commitmentName').focus(); }
    function closeCommitmentModal() { byId('commitmentModal').hidden = true; }

    function setView(view) {
        const labels = { overview: 'Resumen', transactions: 'Movimientos', commitments: 'Compromisos del mes' };
        $$('.view-section').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
        $$('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
        byId('breadcrumbLabel').textContent = labels[view] || labels.overview;
        byId('sidebar').classList.remove('open');
        if (view === 'transactions') renderTransactions();
        if (view === 'commitments') renderCommitments();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function bindEvents() {
        $$('.nav-link').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
        $$('[data-goto]').forEach(button => button.addEventListener('click', () => setView(button.dataset.goto)));
        byId('addMovementButton').addEventListener('click', openMovementModal);
        $$('[data-open-modal]').forEach(button => button.addEventListener('click', openMovementModal));
        byId('addCommitmentButton').addEventListener('click', openCommitmentModal);
        $$('[data-add-commitment]').forEach(button => button.addEventListener('click', openCommitmentModal));
        byId('menuButton').addEventListener('click', () => byId('sidebar').classList.toggle('open'));
        byId('exportDataButton').addEventListener('click', exportData);
        byId('importDataButton').addEventListener('click', () => byId('importDataInput').click());
        byId('importDataInput').addEventListener('change', event => importData(event.target.files[0]));
        byId('logoutButton').addEventListener('click', () => {
            byId('sidebar').classList.remove('open');
            byId('appShell').hidden = true;
            byId('loginScreen').hidden = false;
            setLoginMode('login');
        });
        $$('.period-tab').forEach(button => button.addEventListener('click', () => {
            state.period = button.dataset.period;
            state.anchor = startOfDay(new Date());
            $$('.period-tab').forEach(tab => tab.classList.toggle('active', tab === button));
            renderOverview();
        }));
        byId('previousPeriod').addEventListener('click', () => movePeriod(-1));
        byId('nextPeriod').addEventListener('click', () => movePeriod(1));
        byId('currentPeriod').addEventListener('click', () => { state.anchor = startOfDay(new Date()); renderOverview(); });
        $$('.type-option').forEach(button => button.addEventListener('click', () => {
            byId('movementType').value = button.dataset.type;
            $$('.type-option').forEach(option => option.classList.toggle('active', option === button));
        }));
        byId('movementPaymentMethod').addEventListener('change', updateInstallmentField);
        byId('movementForm').addEventListener('submit', event => {
            event.preventDefault();
            const date = byId('movementDate').value;
            if (!date) return;
            const paymentMethod = byId('movementPaymentMethod').value;
            state.transactions.push({
                id: makeId(), description: byId('movementDescription').value.trim(),
                amount: Number(byId('movementAmount').value), type: byId('movementType').value,
                date, hour: date === dateKey(new Date()) ? new Date().getHours() : 12,
                category: byId('movementCategory').value, notes: byId('movementNotes').value.trim(),
                paymentMethod, installments: paymentMethod === 'credit' ? Number(byId('movementInstallments').value) : null
            });
            saveData(); closeMovementModal(); renderAll(); showToast('Movimiento guardado.');
        });
        byId('commitmentForm').addEventListener('submit', event => {
            event.preventDefault();
            state.commitments.push({
                id: makeId(), name: byId('commitmentName').value.trim(),
                amount: Number(byId('commitmentAmount').value), dueDay: Number(byId('commitmentDueDay').value),
                category: byId('commitmentCategory').value, notes: byId('commitmentNotes').value.trim(), paidMonths: []
            });
            saveData(); closeCommitmentModal(); renderAll(); showToast('Compromiso mensual añadido.');
        });
        $$('.filter-pill').forEach(button => button.addEventListener('click', () => {
            state.transactionFilter = button.dataset.filter;
            $$('.filter-pill').forEach(pill => pill.classList.toggle('active', pill === button));
            renderTransactions();
        }));
        byId('categoryFilter').addEventListener('change', event => { state.categoryFilter = event.target.value; renderTransactions(); });
        document.addEventListener('click', event => {
            const deleteMovement = event.target.closest('[data-delete-movement]');
            if (deleteMovement) {
                state.transactions = state.transactions.filter(item => item.id !== deleteMovement.dataset.deleteMovement);
                saveData(); renderAll(); showToast('Movimiento eliminado.');
            }
            const togglePayment = event.target.closest('[data-toggle-payment]');
            if (togglePayment) toggleCommitmentPayment(togglePayment.dataset.togglePayment);
            const deleteCommitment = event.target.closest('[data-delete-commitment]');
            if (deleteCommitment && confirm('¿Eliminar este compromiso mensual? Se conservarán sus movimientos ya registrados.')) {
                state.commitments = state.commitments.filter(item => item.id !== deleteCommitment.dataset.deleteCommitment);
                saveData(); renderAll(); showToast('Compromiso eliminado.');
            }
        });
        $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeMovementModal));
        $$('[data-close-commitment]').forEach(button => button.addEventListener('click', closeCommitmentModal));
        byId('movementModal').addEventListener('click', event => { if (event.target === byId('movementModal')) closeMovementModal(); });
        byId('commitmentModal').addEventListener('click', event => { if (event.target === byId('commitmentModal')) closeCommitmentModal(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') { closeMovementModal(); closeCommitmentModal(); byId('sidebar').classList.remove('open'); }
        });
    }

    function toggleCommitmentPayment(id) {
        const item = state.commitments.find(commitment => commitment.id === id);
        if (!item) return;
        item.paidMonths ||= [];
        const currentMonth = monthKey();
        const transactionIndex = state.transactions.findIndex(entry => entry.commitmentId === id && entry.commitmentMonth === currentMonth);
        if (item.paidMonths.includes(currentMonth)) {
            item.paidMonths = item.paidMonths.filter(month => month !== currentMonth);
            if (transactionIndex !== -1) state.transactions.splice(transactionIndex, 1);
            showToast('Pago marcado como pendiente.');
        } else {
            item.paidMonths.push(currentMonth);
            if (transactionIndex === -1) {
                const today = new Date();
                state.transactions.push({
                    id: makeId(), description: item.name, amount: Number(item.amount), type: 'expense',
                    date: dateKey(today), hour: today.getHours(), category: item.category,
                    notes: 'Pago de compromiso mensual', commitmentId: item.id, commitmentMonth: currentMonth
                });
            }
            showToast('¡Pago marcado como realizado!');
        }
        saveData(); renderAll();
    }

    function init() { bindEvents(); initLogin(); }
    init();
})();