// ----------------------------
// Golden Trading Journal – Professional Version (Final Clean)
// ----------------------------

// === STATE MANAGEMENT ===
let trades = [];
let startingBalance = new Decimal(0);
let settings = {
    maxTradesPerDay: 5,
    maxDailyLossPercent: 5,
    tiltLossThreshold: 3,
    tiltBreakMinutes: 15
};
let streakData = {
    currentStreak: 0,
    lastTradeDate: null,
    longestStreak: 0
};
let tiltState = {
    isActive: false,
    consecutiveLosses: 0,
    breakEndTime: null,
    activatedAt: null
};
let heatmapData = {};
let currentHeatmapMonth = new Date();

// Configure Decimal.js for maximum precision
if (typeof Decimal !== 'undefined') {
    Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
}

// === UTILITY FUNCTIONS ===
const formatUSD = (num) => {
    if (typeof num === 'string') num = new Decimal(num);
    if (!(num instanceof Decimal)) num = new Decimal(num || 0);
    return `$${num.toFixed(2)}`;
};

const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('sr-RS', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getDateKey = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const getTodayKey = () => {
    const today = new Date();
    return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
};

// === TOAST NOTIFICATIONS ===
const showToast = (message, type = 'info', duration = 4000) => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => removeToast(toast));
    }

    setTimeout(() => removeToast(toast), duration);
};

const removeToast = (toast) => {
    if (!toast) return;
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
};

// === STORAGE FUNCTIONS ===
function loadFromStorage() {
    const savedTrades = localStorage.getItem('golden_trades');
    const savedBalance = localStorage.getItem('golden_balance');
    const savedSettings = localStorage.getItem('golden_settings');
    const savedStreak = localStorage.getItem('golden_streak');
    const savedTilt = localStorage.getItem('golden_tilt');

    if (savedBalance) {
        startingBalance = new Decimal(savedBalance);
    }
    if (savedSettings) {
        try { settings = JSON.parse(savedSettings); } catch (e) { console.error('Settings load error'); }
    }
    if (savedStreak) {
        try { streakData = JSON.parse(savedStreak); } catch (e) { console.error('Streak load error'); }
    }
    if (savedTilt) {
        try { tiltState = JSON.parse(savedTilt); } catch (e) { console.error('Tilt load error'); }
    }
    if (savedTrades) {
        try {
            const parsed = JSON.parse(savedTrades);
            trades = parsed.map(t => ({
                ...t,
                riskPercent: new Decimal(t.riskPercent),
                entry: new Decimal(t.entry),
                stopLoss: new Decimal(t.stopLoss),
                takeProfit: new Decimal(t.takeProfit),
                positionSize: new Decimal(t.positionSize),
                rMultiple: new Decimal(t.rMultiple),
                emotion: parseInt(t.emotion, 10),
                exitPrice: t.exitPrice ? new Decimal(t.exitPrice) : null
            }));
            buildHeatmapData();
        } catch (e) {
            trades = [];
        }
    }
}

function saveToStorage() {
    const tradesForStorage = trades.map(t => ({
        ...t,
        riskPercent: t.riskPercent.toString(),
        entry: t.entry.toString(),
        stopLoss: t.stopLoss.toString(),
        takeProfit: t.takeProfit.toString(),
        positionSize: t.positionSize.toString(),
        rMultiple: t.rMultiple.toString(),
        exitPrice: t.exitPrice ? t.exitPrice.toString() : null
    }));
    
    localStorage.setItem('golden_trades', JSON.stringify(tradesForStorage));
    localStorage.setItem('golden_balance', startingBalance.toString());
    localStorage.setItem('golden_settings', JSON.stringify(settings));
    localStorage.setItem('golden_streak', JSON.stringify(streakData));
    localStorage.setItem('golden_tilt', JSON.stringify(tiltState));
}

function buildHeatmapData() {
    heatmapData = {};
    trades.forEach(trade => {
        const dateKey = getDateKey(trade.date);
        let profit = new Decimal(0);
        
        if (trade.result === 'Win') {
            profit = trade.rMultiple.mul(trade.positionSize);
        } else if (trade.result === 'Loss') {
            profit = new Decimal(-1).mul(trade.positionSize);
            if (trade.exitPrice) {
                const risk = trade.entry.minus(trade.stopLoss).abs();
                const reward = trade.direction === 'Long' ? trade.exitPrice.minus(trade.entry) : trade.entry.minus(trade.exitPrice);
                const actualR = reward.div(risk);
                profit = actualR.mul(trade.positionSize);
            }
        }
        
        if (!heatmapData[dateKey]) {
            heatmapData[dateKey] = new Decimal(0);
        }
        heatmapData[dateKey] = heatmapData[dateKey].plus(profit);
    });
}

// === CALCULATIONS (100% Precise) ===
const calculatePositionSize = (balance, riskPercent, entry, stopLoss) => {
    const riskAmount = balance.mul(riskPercent.div(100));
    const riskDistance = entry.minus(stopLoss).abs();
    if (riskDistance.eq(0)) throw new Error("Stop Loss mora biti različit od Entry.");
    return riskAmount.div(riskDistance);
};

const calculateRMultiple = (entry, stopLoss, exitPrice, direction) => {
    const risk = entry.minus(stopLoss).abs();
    const reward = direction === "Long"
        ? exitPrice.minus(entry)
        : entry.minus(exitPrice);
    return reward.div(risk);
};

// === DASHBOARD STATS ===
const calculateDashboardStats = () => {
    const totalTrades = trades.length;
    if (!totalTrades) return {
        netPnL: new Decimal(0),
        winRate: 0,
        avgRR: new Decimal(0),
        maxDrawdown: new Decimal(0),
        totalTrades: 0
    };

    let wins = 0;
    let totalRR = new Decimal(0);
    let pnl = new Decimal(0);
    let equity = new Decimal(0);
    let peak = new Decimal(0);
    let drawdown = new Decimal(0);

    trades.forEach(trade => {
        let tradePnL = new Decimal(0);
        if (trade.result === 'Win') {
            wins++;
            tradePnL = trade.rMultiple.mul(trade.positionSize);
        } else if (trade.result === 'Loss') {
            tradePnL = new Decimal(-1).mul(trade.positionSize);
            if (trade.exitPrice) {
                const risk = trade.entry.minus(trade.stopLoss).abs();
                const reward = trade.direction === 'Long' ? trade.exitPrice.minus(trade.entry) : trade.entry.minus(trade.exitPrice);
                const actualR = reward.div(risk);
                tradePnL = actualR.mul(trade.positionSize);
            }
        }
        
        totalRR = totalRR.plus(trade.rMultiple);
        pnl = pnl.plus(tradePnL);
        equity = equity.plus(tradePnL);
        
        if (equity.gt(peak)) peak = equity;
        const currentDrawdown = peak.minus(equity);
        if (currentDrawdown.gt(drawdown)) drawdown = currentDrawdown;
    });

    return {
        netPnL: pnl,
        winRate: parseFloat(((wins / totalTrades) * 100).toFixed(1)),
        avgRR: totalRR.div(totalTrades || 1),
        totalTrades,
        maxDrawdown: drawdown
    };
};

// === ANALYTICS ===
const calculateAnalytics = () => {
    const sessions = { Asia: 0, London: 0, 'New York': 0, Overlap: 0 };
    const setups = { Breakout: 0, Pullback: 0, Reversal: 0, Range: 0 };
    let emotionWinsTotal = 0, emotionAllTotal = 0, winCount = 0;
    const sessionPnL = { Asia: new Decimal(0), London: new Decimal(0), 'New York': new Decimal(0), Overlap: new Decimal(0) };
    const setupPnL = { Breakout: new Decimal(0), Pullback: new Decimal(0), Reversal: new Decimal(0), Range: new Decimal(0) };

    trades.forEach(t => {
        if (sessions[t.session] !== undefined) {
            sessions[t.session]++;
            let pnl = t.result === 'Win' ? t.rMultiple.mul(t.positionSize) : new Decimal(-1).mul(t.positionSize);
            sessionPnL[t.session] = sessionPnL[t.session].plus(pnl);
        }
        if (setups[t.setup] !== undefined) {
            setups[t.setup]++;
            let pnl = t.result === 'Win' ? t.rMultiple.mul(t.positionSize) : new Decimal(-1).mul(t.positionSize);
            setupPnL[t.setup] = setupPnL[t.setup].plus(pnl);
        }
        emotionAllTotal += t.emotion;
        if (t.result === "Win") {
            emotionWinsTotal += t.emotion;
            winCount++;
        }
    });

    let bestSession = { name: 'N/A', pnl: new Decimal(-Infinity) };
    let worstSession = { name: 'N/A', pnl: new Decimal(Infinity) };
    let bestSetup = { name: 'N/A', pnl: new Decimal(-Infinity) };
    let worstSetup = { name: 'N/A', pnl: new Decimal(Infinity) };

    Object.entries(sessionPnL).forEach(([name, pnl]) => {
        if (sessions[name] > 0) {
            if (pnl.gt(bestSession.pnl)) bestSession = { name, pnl };
            if (pnl.lt(worstSession.pnl)) worstSession = { name, pnl };
        }
    });
    Object.entries(setupPnL).forEach(([name, pnl]) => {
        if (setups[name] > 0) {
            if (pnl.gt(bestSetup.pnl)) bestSetup = { name, pnl };
            if (pnl.lt(worstSetup.pnl)) worstSetup = { name, pnl };
        }
    });

    return {
        sessions, setups, sessionPnL, setupPnL,
        bestSession, worstSession, bestSetup, worstSetup,
        avgEmotionWin: winCount ? parseFloat((emotionWinsTotal / winCount).toFixed(1)) : 0,
        avgEmotionAll: trades.length ? parseFloat((emotionAllTotal / trades.length).toFixed(1)) : 0
    };
};

// === DAILY GOALS ===
const calculateDailyGoals = () => {
    const today = getTodayKey();
    const todayTrades = trades.filter(t => getDateKey(t.date) === today);
    const tradesCount = todayTrades.length;
    let dailyPnL = new Decimal(0);
    let planFollowed = 0;
    
    todayTrades.forEach(t => {
        let pnl = t.result === 'Win' ? t.rMultiple.mul(t.positionSize) : new Decimal(-1).mul(t.positionSize);
        dailyPnL = dailyPnL.plus(pnl);
        if (t.followedPlan === 'Yes') planFollowed++;
    });

    const stats = calculateDashboardStats();
    const currentEquity = startingBalance.plus(stats.netPnL);

    const dailyLossPercent = currentEquity.gt(0)
        ? dailyPnL.lt(0) ? dailyPnL.abs().div(currentEquity).mul(100) : new Decimal(0)
        : new Decimal(0);

    return {
        tradesCount,
        maxTrades: settings.maxTradesPerDay,
        dailyLossPercent: dailyLossPercent.toNumber(),
        maxDailyLoss: settings.maxDailyLossPercent,
        planFollowed,
        totalToday: tradesCount
    };
};

// === TILT DETECTION ===
const checkTiltState = () => {
    if (trades.length === 0) {
        if (!tiltState.isActive) tiltState.consecutiveLosses = 0;
        return;
    }
    const sortedTrades = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));
    let consecutiveLosses = 0;
    for (const trade of sortedTrades) {
        if (trade.result === 'Loss') {
            consecutiveLosses++;
        } else {
            break;
        }
    }
    tiltState.consecutiveLosses = consecutiveLosses;
    
    if (consecutiveLosses >= settings.tiltLossThreshold && !tiltState.isActive) {
        activateTiltMode();
    }

    if (tiltState.isActive && tiltState.breakEndTime) {
        if (Date.now() > tiltState.breakEndTime) {
            deactivateTiltMode();
        }
    }
    updateTiltWarning();
};

const activateTiltMode = () => {
    tiltState.isActive = true;
    tiltState.breakEndTime = Date.now() + (settings.tiltBreakMinutes * 60 * 1000);
    tiltState.activatedAt = Date.now();
    saveToStorage();
    showToast(`⚠️ TILT režim aktiviran! Pauza od ${settings.tiltBreakMinutes} minuta.`, 'warning', 8000);
};

const deactivateTiltMode = () => {
    tiltState.isActive = false;
    tiltState.breakEndTime = null;
    tiltState.consecutiveLosses = 0;
    tiltState.activatedAt = null;
    saveToStorage();
    showToast('✅ TILT režim deaktiviran. Možete nastaviti sa tradingom.', 'success');
};

const updateTiltWarning = () => {
    const tiltWarning = document.getElementById('tiltWarning');
    const tiltLossCount = document.getElementById('tiltLossCount');
    const tiltTimer = document.getElementById('tiltTimer');
    if (!tiltWarning) return;

    if (tiltState.isActive && tiltState.breakEndTime) {
        tiltWarning.classList.remove('hidden');
        if (tiltLossCount) tiltLossCount.textContent = tiltState.consecutiveLosses;
        
        const timeLeft = Math.max(0, tiltState.breakEndTime - Date.now());
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        if (tiltTimer) tiltTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        tiltWarning.classList.add('hidden');
    }
};

// === STREAK MANAGEMENT ===
const updateStreak = () => {
    const today = getTodayKey();
    const todayTrades = trades.filter(t => getDateKey(t.date) === today);
    const planFollowedToday = todayTrades.some(t => t.followedPlan === 'Yes');
    
    if (streakData.lastTradeDate !== today) {
        if (planFollowedToday) {
            const yesterday = new Date();
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const yesterdayKey = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
            const yesterdayTrades = trades.filter(t => getDateKey(t.date) === yesterdayKey);
            const planFollowedYesterday = yesterdayTrades.some(t => t.followedPlan === 'Yes');

            if (planFollowedYesterday || streakData.lastTradeDate === yesterdayKey) {
                streakData.currentStreak++;
            } else {
                streakData.currentStreak = 1;
            }
            streakData.lastTradeDate = today;
            if (streakData.currentStreak > streakData.longestStreak) {
                streakData.longestStreak = streakData.currentStreak;
            }
        }
    }
    saveToStorage();
    updateStreakDisplay();
};

const updateStreakDisplay = () => {
    const streakCount = document.getElementById('streakCount');
    if (streakCount) streakCount.textContent = streakData.currentStreak;
};

// === SMART SUGGESTIONS ===
const generateSmartSuggestions = () => {
    const container = document.getElementById('smartSuggestions');
    if (!container) return;
    
    if (trades.length < 5) {
        container.innerHTML = `<div class="suggestion-card info"><p>📊 Dodajte još tradeova za personalizovane preporuke. (Trenutno: ${trades.length})</p></div>`;
        return;
    }

    const analytics = calculateAnalytics();
    const stats = calculateDashboardStats();
    const suggestions = [];

    if (stats.winRate < 40) {
        suggestions.push({ type: 'warning', message: `⚠️ Win Rate je ${stats.winRate}%. Razmotrite da budete selektivniji.` });
    } else if (stats.winRate > 60) {
        suggestions.push({ type: 'success', message: `🎉 Odličan Win Rate od ${stats.winRate}%!` });
    }

    if (analytics.worstSession.name !== 'N/A' && analytics.worstSession.pnl.lt(0)) {
        suggestions.push({ type: 'warning', message: `🌍 ${analytics.worstSession.name} sesija ima negativan PnL.` });
    }

    if (analytics.avgEmotionAll > 7) {
        suggestions.push({ type: 'warning', message: `😰 Prosečna emocija je ${analytics.avgEmotionAll}/10. Smirite se.` });
    }

    if (suggestions.length === 0) {
        suggestions.push({ type: 'success', message: `✅ Sve izgleda odlično!` });
    }

    container.innerHTML = suggestions.map(s => `
        <div class="suggestion-card ${s.type}">
            <p>${s.message}</p>
        </div>
    `).join('');
};

// === HEATMAP CALENDAR ===
const renderHeatmap = () => {
    const grid = document.getElementById('heatmapGrid');
    const monthLabel = document.getElementById('heatmapMonth');
    if (!grid || !monthLabel) return;
    
    const year = currentHeatmapMonth.getUTCFullYear();
    const month = currentHeatmapMonth.getUTCMonth();
    monthLabel.textContent = new Date(year, month).toLocaleDateString('sr-RS', { month: 'long', year: 'numeric' });
    grid.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'heatmap-day empty';
        grid.appendChild(emptyDay);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayPnL = heatmapData[dateKey] || new Decimal(0);
        
        dayEl.className = 'heatmap-day';
        dayEl.textContent = day;
        dayEl.setAttribute('data-pnl', formatUSD(dayPnL));

        if (today.getUTCFullYear() === year && today.getUTCMonth() === month && today.getUTCDate() === day) {
            dayEl.classList.add('today');
        }
        if (dayPnL.gt(0)) dayEl.classList.add('profit');
        else if (dayPnL.lt(0)) dayEl.classList.add('loss');
        else if (heatmapData[dateKey]) dayEl.classList.add('break-even');

        grid.appendChild(dayEl);
    }
};

// === DOM UPDATES ===
const updateDashboard = () => {
    const stats = calculateDashboardStats();
    
    const balanceEl = document.getElementById('balanceCard');
    if (balanceEl) {
        balanceEl.textContent = formatUSD(stats.netPnL);
        balanceEl.className = stats.netPnL.gte(0) ? 'value positive' : 'value negative';
    }

    const winRateEl = document.getElementById('winRateCard');
    if (winRateEl) winRateEl.textContent = `${stats.winRate}%`;

    const avgRREl = document.getElementById('avgRRCard');
    if (avgRREl) avgRREl.textContent = stats.avgRR.toFixed(2);

    const totalTradesEl = document.getElementById('totalTradesCard');
    if (totalTradesEl) totalTradesEl.textContent = stats.totalTrades;

    const drawdownEl = document.getElementById('drawdownCard');
    if (drawdownEl) drawdownEl.textContent = formatUSD(stats.maxDrawdown);

    const winLossEl = document.getElementById('winLossRatio');
    if (winLossEl) {
        const angle = stats.winRate * 3.6;
        winLossEl.style.background = `conic-gradient(var(--gold) 0deg ${angle}deg, var(--card-bg) ${angle}deg 360deg)`;
        winLossEl.setAttribute('data-percent', `${stats.winRate}%`);
    }

    updateEquityCurve();
    updateAnalyticsCards();
    updateDailyGoals();
    generateSmartSuggestions();

    const currentBalance = startingBalance.plus(stats.netPnL);
    const headerBalanceEl = document.getElementById('headerBalance');
    if (headerBalanceEl) headerBalanceEl.textContent = formatUSD(currentBalance);

    updateStreak();
    checkTiltState();
};

const updateDailyGoals = () => {
    const goals = calculateDailyGoals();
    
    const tradesTodayCount = document.getElementById('tradesTodayCount');
    const tradesProgress = document.getElementById('tradesProgress');
    if (tradesTodayCount && tradesProgress) {
        tradesTodayCount.textContent = `${goals.tradesCount}/${goals.maxTrades}`;
        const tradesPercent = Math.min(100, (goals.tradesCount / goals.maxTrades) * 100);
        tradesProgress.style.width = `${tradesPercent}%`;
        if (goals.tradesCount >= goals.maxTrades) tradesProgress.style.background = 'linear-gradient(90deg, var(--negative), #fca5a5)';
    }

    const dailyLossCount = document.getElementById('dailyLossCount');
    const lossProgress = document.getElementById('lossProgress');
    if (dailyLossCount && lossProgress) {
        dailyLossCount.textContent = `${goals.dailyLossPercent.toFixed(1)}%/${goals.maxDailyLoss}%`;
        const lossPercent = Math.min(100, (goals.dailyLossPercent / goals.maxDailyLoss) * 100);
        lossProgress.style.width = `${lossPercent}%`;
    }

    const planFollowedCount = document.getElementById('planFollowedCount');
    const planProgress = document.getElementById('planProgress');
    if (planFollowedCount && planProgress) {
        planFollowedCount.textContent = `${goals.planFollowed}/${goals.totalToday}`;
        const planPercent = goals.totalToday > 0 ? (goals.planFollowed / goals.totalToday) * 100 : 0;
        planProgress.style.width = `${planPercent}%`;
    }
};

const updateTradeHistory = (filterText = '', filterResult = 'all') => {
    const tbody = document.getElementById('tradeHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let filteredTrades = [...trades];
    if (filterText) {
        filteredTrades = filteredTrades.filter(t =>
            t.pair.toLowerCase().includes(filterText.toLowerCase()) ||
            t.setup.toLowerCase().includes(filterText.toLowerCase()) ||
            t.session.toLowerCase().includes(filterText.toLowerCase())
        );
    }
    if (filterResult !== 'all') {
        filteredTrades = filteredTrades.filter(t => t.result === filterResult);
    }

    filteredTrades.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="Date">${formatDate(t.date)}</td>
            <td data-label="Pair">${t.pair}</td>
            <td data-label="Setup">${t.setup}</td>
            <td data-label="Session">${t.session}</td>
            <td data-label="Risk %">${t.riskPercent.toString()}%</td>
            <td data-label="R:R">${t.rMultiple.toFixed(2)}</td>
            <td data-label="Result" class="${t.result === 'Win' ? 'positive' : 'negative'}">${t.result}</td>
            <td data-label="Plan">${t.followedPlan}</td>
            <td data-label="Emotion">${t.emotion}</td>
            <td data-label="Actions">
                <div class="table-actions">
                    <button class="table-btn edit" onclick="openEditModal('${t.date}')" title="Edit">✏️</button>
                    <button class="table-btn delete" onclick="confirmDeleteTrade('${t.date}')" title="Delete">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
};

const updateEquityCurve = () => {
    const container = document.getElementById('equityCurve');
    if (!container) return;
    container.innerHTML = '';
    
    if (trades.length === 0) {
        container.textContent = 'No trades recorded yet';
        container.style.color = 'var(--text-secondary)';
        return;
    }

    let equity = new Decimal(0);
    const bars = [];
    trades.forEach(t => {
        let pnl = t.result === 'Win' ? t.rMultiple.mul(t.positionSize) : new Decimal(-1).mul(t.positionSize);
        equity = equity.plus(pnl);
        bars.push({ equity, isPositive: equity.gte(0) });
    });

    const maxAbs = bars.reduce((max, bar) => {
        const abs = bar.equity.abs();
        return abs.gt(max) ? abs : max;
    }, new Decimal(1));

    bars.forEach(bar => {
        const heightRatio = bar.equity.abs().div(maxAbs).toNumber();
        const height = Math.max(4, Math.min(24, heightRatio * 24));
        const barEl = document.createElement('div');
        Object.assign(barEl.style, {
            height: `${height}px`, width: '4px',
            background: bar.isPositive ? '#4ade80' : '#f87171',
            borderRadius: '2px', margin: '0 1px', flexShrink: '0'
        });
        barEl.title = `PnL: ${formatUSD(bar.equity)}`;
        container.appendChild(barEl);
    });
};

const updateAnalyticsCards = () => {
    const a = calculateAnalytics();
    const sCont = document.getElementById('sessionsAnalytics');
    const stCont = document.getElementById('setupsAnalytics');
    const eCont = document.getElementById('emotionAnalytics');
    const bwCont = document.getElementById('bestWorstAnalytics');
    
    if (sCont) {
        sCont.innerHTML = Object.entries(a.sessions).filter(([_, v]) => v > 0).map(([k, v]) => {
            const pnl = a.sessionPnL[k];
            return `<div>${k}: ${v} (${formatUSD(pnl)})</div>`;
        }).join('') || 'No data';
    }
    if (stCont) {
        stCont.innerHTML = Object.entries(a.setups).filter(([_, v]) => v > 0).map(([k, v]) => {
            const pnl = a.setupPnL[k];
            return `<div>${k}: ${v} (${formatUSD(pnl)})</div>`;
        }).join('') || 'No data';
    }
    if (eCont) eCont.textContent = `Avg Emotion (Wins): ${a.avgEmotionWin} | Avg Emotion (All): ${a.avgEmotionAll}`;
    if (bwCont) {
        bwCont.innerHTML = `
            <div>Best Session: <span class="positive">${a.bestSession.name}</span> (${formatUSD(a.bestSession.pnl)})</div>
            <div>Worst Session: <span class="negative">${a.worstSession.name}</span> (${formatUSD(a.worstSession.pnl)})</div>
            <div>Best Setup: <span class="positive">${a.bestSetup.name}</span> (${formatUSD(a.bestSetup.pnl)})</div>
            <div>Worst Setup: <span class="negative">${a.worstSetup.name}</span> (${formatUSD(a.worstSetup.pnl)})</div>
        `;
    }
};

// === EDIT/DELETE FUNCTIONS ===
window.openEditModal = (tradeDate) => {
    const trade = trades.find(t => t.date === tradeDate);
    if (!trade) return;
    
    document.getElementById('editTradeId').value = trade.date;
    document.getElementById('editPair').value = trade.pair;
    document.getElementById('editEntry').value = trade.entry.toString();
    document.getElementById('editStopLoss').value = trade.stopLoss.toString();
    document.getElementById('editTakeProfit').value = trade.takeProfit.toString();

    const editExit = document.getElementById('editExitPrice');
    if(editExit) editExit.value = trade.exitPrice ? trade.exitPrice.toString() : '';

    document.getElementById('editSetup').value = trade.setup;
    document.getElementById('editSession').value = trade.session;
    document.getElementById('editEmotion').value = trade.emotion;
    document.getElementById('editFollowedPlan').value = trade.followedPlan;

    const editResult = document.getElementById('editResult');
    if(editResult) editResult.value = trade.result;

    document.getElementById('editNotes').value = trade.notes || '';
    document.getElementById('editTradeModal').style.display = 'flex';
};

window.confirmDeleteTrade = (tradeDate) => {
    if (confirm('Da li ste sigurni da želite da obrišete ovaj trade?')) {
        deleteTrade(tradeDate);
    }
};

const deleteTrade = (tradeDate) => {
    trades = trades.filter(t => t.date !== tradeDate);
    buildHeatmapData();
    saveToStorage();
    updateDashboard();
    updateTradeHistory();
    showToast('Trade obrisan', 'success');
};

// === BACKUP/RESTORE ===
const backupData = () => {
    const data = {
        trades: trades.map(t => ({ ...t, riskPercent: t.riskPercent.toString(), entry: t.entry.toString(), stopLoss: t.stopLoss.toString(), takeProfit: t.takeProfit.toString(), positionSize: t.positionSize.toString(), rMultiple: t.rMultiple.toString(), exitPrice: t.exitPrice ? t.exitPrice.toString() : null })),
        startingBalance: startingBalance.toString(),
        settings, streakData, tiltState,
        backupDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `golden_journal_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup uspešno kreiran!', 'success');
};

const restoreData = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.trades || !data.startingBalance) throw new Error('Invalid backup file');
            
            trades = data.trades.map(t => ({
                ...t, riskPercent: new Decimal(t.riskPercent), entry: new Decimal(t.entry),
                stopLoss: new Decimal(t.stopLoss), takeProfit: new Decimal(t.takeProfit),
                positionSize: new Decimal(t.positionSize), rMultiple: new Decimal(t.rMultiple),
                emotion: parseInt(t.emotion, 10), exitPrice: t.exitPrice ? new Decimal(t.exitPrice) : null
            }));
            startingBalance = new Decimal(data.startingBalance);
            if (data.settings) settings = data.settings;
            if (data.streakData) streakData = data.streakData;
            if (data.tiltState) tiltState = data.tiltState;
            
            buildHeatmapData();
            saveToStorage();
            updateDashboard();
            updateTradeHistory();
            showToast('Podaci uspešno restore-ovani!', 'success');
        } catch (err) {
            showToast('Greška pri restore-ovanju: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
};

// === EVENT HANDLERS ===
document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    
    // Start Journal Button
    document.getElementById('startJournalBtn')?.addEventListener('click', () => {
        const input = document.getElementById('initialBalanceInput');
        const val = input.value.trim();
        if (!val || isNaN(val) || parseFloat(val) <= 0) {
            showToast('Unesite validan početni balans.', 'error');
            return;
        }
        startingBalance = new Decimal(val);
        saveToStorage();
        
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) {
            mainApp.style.display = 'block';
            mainApp.classList.remove('hidden');
        }
        updateDashboard();
        updateTradeHistory();
        renderHeatmap();
        showToast('Journal uspešno pokrenut!', 'success');
    });

    // Reset Journal
    document.getElementById('resetJournalBtn')?.addEventListener('click', () => {
        if (confirm('Da li ste sigurni da želite da resetujete ceo journal? Svi podaci će biti izgubljeni.')) {
            localStorage.removeItem('golden_trades');
            localStorage.removeItem('golden_balance');
            localStorage.removeItem('golden_settings');
            localStorage.removeItem('golden_streak');
            localStorage.removeItem('golden_tilt');

            trades = [];
            startingBalance = new Decimal(0); 
            streakData = { currentStreak: 0, lastTradeDate: null, longestStreak: 0 };
            tiltState = { isActive: false, consecutiveLosses: 0, breakEndTime: null, activatedAt: null };

            const input = document.getElementById('initialBalanceInput');
            if (input) input.value = '';  

            if (mainApp) mainApp.style.display = 'none';
            if (loginScreen) loginScreen.style.display = 'flex';

            updateDashboard();
            updateTradeHistory();
            showToast('Journal je resetovan. Unesite novi balans.', 'success');
        }
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        if (confirm('Vratiti se na setup ekran?')) {
            if (mainApp) mainApp.style.display = 'none';
            if (loginScreen) loginScreen.style.display = 'flex';
        }
    });

    // Toggle groups (Buy/Sell, Setup, etc.)
    document.querySelectorAll('.toggle-group').forEach(group => {
        group.addEventListener('click', (e) => {
            if (e.target.classList.contains('toggle-option')) {
                group.querySelectorAll('.toggle-option').forEach(opt => opt.classList.remove('active'));
                e.target.classList.add('active');
                const input = group.closest('.form-group')?.querySelector('input[type="hidden"]');
                if (input) {
                    const map = {
                        long: 'Long', short: 'Short',
                        breakout: 'Breakout', pullback: 'Pullback', reversal: 'Reversal', range: 'Range',
                        asia: 'Asia', london: 'London', ny: 'New York', overlap: 'Overlap',
                        yes: 'Yes', no: 'No',
                        win: 'Win', loss: 'Loss', be: 'BE'
                    };
                    input.value = map[e.target.getAttribute('data-value')] || e.target.getAttribute('data-value');
                }
            }
        });
    });

    // Emotion slider
    const emotionSlider = document.getElementById('emotion');
    if (emotionSlider) {
        emotionSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            const emotionValueEl = document.getElementById('emotionValue');
            const emotionFillEl = document.getElementById('emotionFill');
            if (emotionValueEl) emotionValueEl.textContent = val;
            if (emotionFillEl) emotionFillEl.style.width = `${val * 10}%`;
        });
    }

    // CSV Export
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
        if (trades.length === 0) { showToast('Nema tradeova za eksport', 'warning'); return; }
        let csv = 'Date,Pair,Direction,Setup,Session,Risk%,R:R,Result,Plan,Emotion,Notes\n';
        trades.forEach(t => {
            csv += `"${t.date}", "${t.pair}", "${t.direction}", "${t.setup}", "${t.session}",${t.riskPercent.toString()},${t.rMultiple.toFixed(6)}, "${t.result}", "${t.followedPlan}",${t.emotion}, "${t.notes || ''}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'golden_trading_journal.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV eksportovan!', 'success');
    });

    // Backup/Restore
    document.getElementById('backupBtn')?.addEventListener('click', backupData);
    document.getElementById('restoreBtn')?.addEventListener('click', () => document.getElementById('restoreFile').click());
    document.getElementById('restoreFile')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (confirm('Ovo će zameniti sve trenutne podatke. Nastaviti?')) restoreData(file);
        }
        e.target.value = '';
    });

    // Form validation
    const formInputs = document.querySelectorAll('#addTradeForm .form-control');
    formInputs.forEach(input => {
        input.addEventListener('blur', () => {
            const errorEl = document.getElementById(`${input.id}Error`);
            if (!errorEl) return;
            errorEl.textContent = '';
            input.classList.remove('error');
            
            if (input.id === 'stopLoss' || input.id === 'entry') {
                const direction = document.getElementById('direction').value;
                const entryVal = document.getElementById('entry').value;
                const stopLossVal = document.getElementById('stopLoss').value;
                
                if(entryVal && stopLossVal) {
                    const entry = new Decimal(entryVal);
                    const stopLoss = new Decimal(stopLossVal);
                    
                    if (entry.gt(0) && stopLoss.gt(0)) {
                        if ((direction === 'Long' && stopLoss.gte(entry)) || (direction === 'Short' && stopLoss.lte(entry))) {
                            errorEl.textContent = `Stop Loss mora biti ${direction === 'Long' ? 'ispod' : 'iznad'} Entry`;
                            input.classList.add('error');
                        }
                    }
                }
            }
        });
    });

    // Form submit - FIXED: Clears all fields to empty as requested
    document.getElementById('addTradeForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (tiltState.isActive) { showToast('⚠️ TILT režim je aktivan.', 'error'); return; }

        const pair = document.getElementById('pair')?.value.trim();
        const date = document.getElementById('date')?.value;
        const direction = document.getElementById('direction')?.value;
        const riskPercent = new Decimal(document.getElementById('riskPercent')?.value);
        const entry = new Decimal(document.getElementById('entry')?.value);
        const stopLoss = new Decimal(document.getElementById('stopLoss')?.value);
        const takeProfit = new Decimal(document.getElementById('takeProfit')?.value);
        
        const exitPriceInput = document.getElementById('exitPrice');
        const exitPrice = exitPriceInput && exitPriceInput.value ? new Decimal(exitPriceInput.value) : null;
        
        const setup = document.getElementById('setup')?.value;
        const session = document.getElementById('session')?.value;
        const emotion = parseInt(document.getElementById('emotion')?.value, 10);
        const followedPlan = document.getElementById('followedPlan')?.value;
        const notes = document.getElementById('notes')?.value.trim();
        
        const resultInput = document.getElementById('result');
        let result = 'Loss'; 
        if (resultInput && resultInput.value) {
            result = resultInput.value;
        } else {
            if (exitPrice) {
                const risk = entry.minus(stopLoss).abs();
                const reward = direction === 'Long' ? exitPrice.minus(entry) : entry.minus(exitPrice);
                const actualR = reward.div(risk);
                result = actualR.gt(0) ? 'Win' : 'Loss';
            } else {
                showToast('Unesite Exit Price ili izaberite Result (Win/Loss)', 'warning');
                result = (direction === 'Long' ? takeProfit.gt(entry) : takeProfit.lt(entry)) ? 'Win' : 'Loss';
            }
        }

        if (!pair || !date || riskPercent.lte(0) || entry.isNaN() || stopLoss.isNaN()) {
            showToast('Popunite sva polja sa validnim vrednostima', 'error');
            return;
        }

        try {
            const statsSoFar = calculateDashboardStats();
            const currentBalance = startingBalance.plus(statsSoFar.netPnL);
            if (currentBalance.lte(0)) { showToast('Balans računa je 0.', 'error'); return; }

            const positionSize = calculatePositionSize(currentBalance, riskPercent, entry, stopLoss);
            
            let rMultiple = new Decimal(0);
            if (exitPrice) {
                rMultiple = calculateRMultiple(entry, stopLoss, exitPrice, direction);
            } else {
                rMultiple = calculateRMultiple(entry, stopLoss, takeProfit, direction);
            }

            trades.push({
                pair, date, direction, riskPercent, entry, stopLoss, takeProfit,
                setup, session, emotion, followedPlan, notes,
                positionSize, rMultiple, result, exitPrice
            });

            buildHeatmapData();
            saveToStorage();

            // RESET FORM TO EMPTY (User Preference)
            document.getElementById('pair').value = '';
            document.getElementById('riskPercent').value = '';
            document.getElementById('entry').value = '';
            document.getElementById('stopLoss').value = '';
            document.getElementById('takeProfit').value = '';
            document.getElementById('exitPrice').value = '';
            document.getElementById('notes').value = '';
            
            // Reset toggles visually but keep date for convenience or reset if preferred
            document.querySelectorAll('#addTradeForm .toggle-option').forEach(opt => opt.classList.remove('active'));
            document.getElementById('direction').value = '';
            document.getElementById('setup').value = '';
            document.getElementById('session').value = '';
            document.getElementById('followedPlan').value = '';
            document.getElementById('result').value = '';
            
            // Reset emotion to default
            document.getElementById('emotion').value = '5';
            document.getElementById('emotionValue').textContent = '5';
            document.getElementById('emotionFill').style.width = '50%';

            updateTradeHistory();
            updateDashboard();
            showToast(`Trade sačuvan! ${result}`, 'success');
            document.querySelector('.history-section')?.scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
            showToast('Greška: ' + err.message, 'error');
        }
    });

    // Search and filter
    const searchInput = document.getElementById('searchTrade');
    const filterSelect = document.getElementById('filterResult');
    if (searchInput) searchInput.addEventListener('input', (e) => updateTradeHistory(e.target.value, filterSelect?.value || 'all'));
    if (filterSelect) filterSelect.addEventListener('change', (e) => updateTradeHistory(searchInput?.value || '', e.target.value));

    // Heatmap nav
    document.getElementById('prevMonthBtn')?.addEventListener('click', () => { currentHeatmapMonth.setUTCMonth(currentHeatmapMonth.getUTCMonth() - 1); renderHeatmap(); });
    document.getElementById('nextMonthBtn')?.addEventListener('click', () => { currentHeatmapMonth.setUTCMonth(currentHeatmapMonth.getUTCMonth() + 1); renderHeatmap(); });

    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const settingsClose = document.querySelector('.settings-close');
    if (settingsBtn && settingsModal && settingsClose) {
        settingsBtn.addEventListener('click', () => {
            document.getElementById('maxTradesPerDay').value = settings.maxTradesPerDay;
            document.getElementById('maxDailyLossPercent').value = settings.maxDailyLossPercent;
            document.getElementById('tiltLossThreshold').value = settings.tiltLossThreshold;
            document.getElementById('tiltBreakMinutes').value = settings.tiltBreakMinutes;
            settingsModal.style.display = 'flex';
        });
        settingsClose.addEventListener('click', () => settingsModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });
    }
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
        settings.maxTradesPerDay = parseInt(document.getElementById('maxTradesPerDay').value, 10);
        settings.maxDailyLossPercent = parseFloat(document.getElementById('maxDailyLossPercent').value);
        settings.tiltLossThreshold = parseInt(document.getElementById('tiltLossThreshold').value, 10);
        settings.tiltBreakMinutes = parseInt(document.getElementById('tiltBreakMinutes').value, 10);
        saveToStorage();
        settingsModal.style.display = 'none';
        showToast('Podešavanja sačuvana', 'success');
    });

    // Edit Modal
    const editClose = document.querySelector('.edit-close');
    const editModal = document.getElementById('editTradeModal');
    if (editClose && editModal) {
        editClose.addEventListener('click', () => editModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });
    }
    document.getElementById('editTradeForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const tradeId = document.getElementById('editTradeId').value;
        const tradeIndex = trades.findIndex(t => t.date === tradeId);
        if (tradeIndex === -1) { showToast('Trade nije pronađen', 'error'); return; }
        const trade = trades[tradeIndex];
        
        trade.pair = document.getElementById('editPair').value;
        trade.entry = new Decimal(document.getElementById('editEntry').value);
        trade.stopLoss = new Decimal(document.getElementById('editStopLoss').value);
        trade.takeProfit = new Decimal(document.getElementById('editTakeProfit').value);
        
        const editExit = document.getElementById('editExitPrice');
        trade.exitPrice = editExit && editExit.value ? new Decimal(editExit.value) : null;

        trade.setup = document.getElementById('editSetup').value;
        trade.session = document.getElementById('editSession').value;
        trade.emotion = parseInt(document.getElementById('editEmotion').value, 10);
        trade.followedPlan = document.getElementById('editFollowedPlan').value;
        trade.notes = document.getElementById('editNotes').value;
        
        const editResult = document.getElementById('editResult');
        if(editResult) trade.result = editResult.value;

        const exitP = trade.exitPrice || trade.takeProfit;
        trade.rMultiple = calculateRMultiple(trade.entry, trade.stopLoss, exitP, trade.direction);
        if(!editResult) {
            trade.result = (trade.direction === 'Long' ? exitP.gt(trade.entry) : exitP.lt(trade.entry)) ? 'Win' : 'Loss';
        }

        buildHeatmapData();
        saveToStorage();
        updateDashboard();
        updateTradeHistory();
        editModal.style.display = 'none';
        showToast('Trade ažuriran', 'success');
    });
    document.getElementById('deleteTradeBtn')?.addEventListener('click', () => {
        const tradeId = document.getElementById('editTradeId').value;
        if (confirm('Da li ste sigurni?')) { deleteTrade(tradeId); editModal.style.display = 'none'; }
    });

    document.getElementById('dismissTiltBtn')?.addEventListener('click', () => document.getElementById('tiltWarning').classList.add('hidden'));

    // Info Modal
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeBtn = document.querySelector('.close-btn');
    if (infoBtn && infoModal && closeBtn) {
        infoBtn.addEventListener('click', () => infoModal.style.display = 'flex');
        closeBtn.addEventListener('click', () => infoModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.style.display = 'none'; });
    }

    // Tilt Timer
    setInterval(() => { if (tiltState.isActive) updateTiltWarning(); }, 1000);

    // Init
    loadFromStorage();
    const now = new Date();
    const dateInput = document.getElementById('date');
    if (dateInput) dateInput.value = now.toISOString().slice(0, 16);

    if (localStorage.getItem('golden_balance')) {
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) { mainApp.style.display = 'block'; mainApp.classList.remove('hidden'); }
        updateDashboard();
        updateTradeHistory();
        renderHeatmap();
    } else {
        if (loginScreen) loginScreen.style.display = 'flex';
        if (mainApp) { mainApp.style.display = 'none'; mainApp.classList.add('hidden'); }
    }
});