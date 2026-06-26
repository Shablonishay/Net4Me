'use strict';

// ===== Constants =====
const STORAGE_KEY = 'natuni_data';
const HEIGHT_M    = 1.83;
const SITES       = ['רגל ימין', 'רגל שמאל', 'יד ימין', 'יד שמאל'];
const SITE_COLORS = ['#1a6b8a', '#2a90b8', '#27ae60', '#e8a020'];
const EX_TYPES    = ['הליכה', 'שחייה', 'אופניים', 'חדר כושר', 'יוגה / פילאטיס', 'אחר'];

const SEED_RECORDS = [
  { id: '1748995200000', hebrewDate: "כ' בסיוון",  gregorianDate: '2026-06-05', site: 'רגל ימין',  dose: 0.25, weight: 144.4, weightWithShoes: true,  notes: '' },
  { id: '1749600000000', hebrewDate: 'כ"ז בסיוון', gregorianDate: '2026-06-12', site: 'רגל שמאל', dose: 0.25, weight: 143.0, weightWithShoes: false, notes: '' },
  { id: '1750204800000', hebrewDate: "ד' בתמוז",   gregorianDate: '2026-06-19', site: 'יד ימין',   dose: 0.25, weight: 143.4, weightWithShoes: false, notes: '' },
  { id: '1750809600000', hebrewDate: 'י"א בתמוז',  gregorianDate: '2026-06-26', site: 'יד שמאל',  dose: 0.25, weight: 141.5, weightWithShoes: false, notes: '' },
];

// ===== Chart instances =====
let chartOverviewInst   = null;
let chartWeightInst     = null;
let chartSitesInst      = null;
let chartTrendInst      = null;
let chartFitnessInst    = null;
let chartCorrInst       = null;

// ===== Sort state =====
let injSort = { field: 'gregorianDate', dir: 'desc' };
let exSort  = { field: 'date', dir: 'desc' };

// ===== Delete callback =====
let pendingDeleteFn = null;

// ===== Injection edit id =====
let editingInjectionId = null;
let editingExerciseId  = null;

// ================================================
// Hebrew Calendar (Dershowitz-Reingold algorithm)
// ================================================

function numToHebrew(n) {
  if (n <= 0 || n > 30) return String(n);
  const ones  = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens  = ['', 'י', 'כ', 'ל'];
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (t === 0) return ones[o] + '׳';          // e.g. א'
  if (o === 0) return tens[t] + '׳';          // e.g. כ'
  return tens[t] + '״' + ones[o];             // e.g. כ"ז
}

const HEB_MONTHS = ['תשרי','חשוון','כסלו','טבת','שבט','אדר','ניסן','אייר','סיוון','תמוז','אב','אלול'];
const HEB_MONTHS_LEAP = ['תשרי','חשוון','כסלו','טבת','שבט','אדר א\'','אדר ב\'','ניסן','אייר','סיוון','תמוז','אב','אלול'];

function isHebrewLeapYear(y) {
  return ((7 * y + 1) % 19) < 7;
}

function hebrewMonthsInYear(y) {
  return isHebrewLeapYear(y) ? 13 : 12;
}

function hebrewElapsedDays(y) {
  const monthsElapsed = Math.floor((235 * y - 234) / 19);
  const parts = 12084 + 13753 * monthsElapsed;
  let day = monthsElapsed * 29 + Math.floor(parts / 25920);
  if (((3 * (day + 1)) % 7) < 3) day++;
  return day;
}

function hebrewYearDays(y) {
  return hebrewElapsedDays(y + 1) - hebrewElapsedDays(y);
}

function hebrewMonthDays(y, m) {
  const leap = isHebrewLeapYear(y);
  const months = leap ? 13 : 12;
  // month lengths
  const base = [30,29,30,29,30,29,30,29,30,29,30,29,30];
  if (m === 8 && hebrewYearDays(y) % 10 !== 5) return 29;
  if (m === 9 && hebrewYearDays(y) % 10 === 3) return 30;
  if (m === 6 && !leap) return 0;
  if (m > months) return 0;
  return base[m - 1];
}

function gregorianToJD(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
       + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function jdToHebrew(jd) {
  const jd0 = Math.floor(jd) + 0.5;
  let year = Math.floor((jd0 - 347997) / 365.25);
  while (hebrewElapsedDays(year + 1) <= jd0 - 347996) year++;
  const yearStart = hebrewElapsedDays(year) + 347996;
  let month = 1;
  const numMonths = hebrewMonthsInYear(year);
  while (month <= numMonths) {
    const md = hebrewMonthDays(year, month);
    if (md === 0 || yearStart + accumulatedDays(year, month) + md > jd0) break;
    month++;
  }
  const day = Math.floor(jd0 - yearStart - accumulatedDays(year, month)) + 1;
  return { year, month, day };
}

function accumulatedDays(year, month) {
  let days = 0;
  for (let m = 1; m < month; m++) days += hebrewMonthDays(year, m);
  return days;
}

function gregorianToHebrew(year, month, day) {
  const jd = gregorianToJD(year, month, day);
  return jdToHebrew(jd);
}

function formatHebrewDate(h) {
  const leap = isHebrewLeapYear(h.year);
  const months = leap ? HEB_MONTHS_LEAP : HEB_MONTHS;
  const monthName = months[h.month - 1] || '';
  return numToHebrew(h.day) + ' ב' + monthName;
}

function autoFillHebrewDate(gregorianStr) {
  if (!gregorianStr) return '';
  const [y, m, d] = gregorianStr.split('-').map(Number);
  try {
    const h = gregorianToHebrew(y, m, d);
    return formatHebrewDate(h);
  } catch (e) {
    return '';
  }
}

// ===== Format Gregorian date in Hebrew style =====
function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const [y, m, d] = isoStr.split('-');
  return `${Number(d)} ב${monthNameHe(Number(m))} ${y}`;
}

function monthNameHe(m) {
  const names = ['','ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return names[m] || '';
}

function addDays(isoStr, days) {
  const d = new Date(isoStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function weekStart(isoStr) {
  const d = new Date(isoStr);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

// ===== BMI =====
function calcBMI(weight) {
  return Math.round((weight / (HEIGHT_M * HEIGHT_M)) * 10) / 10;
}

function bmiCategory(bmi) {
  if (bmi >= 40)  return { label: 'השמנת יתר חמורה (שלב 3)', color: '#c0392b' };
  if (bmi >= 35)  return { label: 'השמנת יתר (שלב 2)',        color: '#c0392b' };
  if (bmi >= 30)  return { label: 'השמנת יתר (שלב 1)',        color: '#e67e22' };
  if (bmi >= 25)  return { label: 'עודף משקל',                 color: '#e67e22' };
  return               { label: 'משקל תקין',                   color: '#27ae60' };
}

function weightForBMI(targetBmi) {
  return Math.round(targetBmi * HEIGHT_M * HEIGHT_M * 10) / 10;
}

// ===== Fitness Recommendations =====
function getFitnessRecommendations(bmi) {
  if (bmi >= 40) return [
    { type: 'do',    icon: '🚶', text: 'הליכה יומית 20–30 דקות — התחל ב-10 דקות והגדל בהדרגה' },
    { type: 'do',    icon: '🏊', text: 'שחייה / הידרותרפיה — מצוינת, מפחיתה עומס על מפרקים' },
    { type: 'do',    icon: '🚴', text: 'רכיבה על אופניים נייח או בשטח שטוח' },
    { type: 'do',    icon: '🪑', text: 'תרגילי כיסא וכוח עדין עם גומיות התנגדות' },
    { type: 'avoid', icon: '🚫', text: 'הימנע מריצה, קפיצות ו-HIIT בשלב זה — עומס יתר על ברכיים ומפרקים' },
    { type: 'avoid', icon: '⚠️', text: 'אל תתאמן אינטנסיבי ביום הזריקה — מנוחה קצרה מועדפת' },
  ];
  if (bmi >= 35) return [
    { type: 'do',    icon: '🚶', text: 'הליכה מהירה 30–45 דקות, 4–5 ימים בשבוע' },
    { type: 'do',    icon: '🏊', text: 'שחייה ורכיבה — ממשיכים להיות אידיאליים' },
    { type: 'do',    icon: '💪', text: 'אימוני כוח קלים: גומיות, משקל גוף, מכשירים בישיבה' },
    { type: 'do',    icon: '🧘', text: 'יוגה ופילאטיס — גמישות ויציבות ליבה' },
    { type: 'avoid', icon: '⚠️', text: 'עדיין מומלץ להימנע מריצה ממושכת — שמור על המפרקים' },
  ];
  if (bmi >= 30) return [
    { type: 'do',    icon: '🏃', text: 'ריצה קלה בהדרגה — שלב intervals: 1 דקה ריצה / 2 הליכה' },
    { type: 'do',    icon: '💪', text: 'אימוני כוח מלאים 2–3 פעמים בשבוע' },
    { type: 'do',    icon: '🏀', text: 'ספורט קבוצתי ופעילויות פנאי אקטיביות' },
    { type: 'do',    icon: '🚴', text: '45–60 דקות קרדיו, 4 ימים בשבוע' },
  ];
  return [
    { type: 'do',    icon: '🏃', text: 'שמור על פעילות גופנית מגוונת — קרדיו + כוח' },
    { type: 'do',    icon: '💪', text: 'אימוני כוח מלאים 3 פעמים בשבוע' },
    { type: 'do',    icon: '⚡', text: 'ניתן להוסיף HIIT ואינטרוולים לגיוון' },
  ];
}

// ================================================
// Data Layer
// ================================================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt — reset */ }
  return { version: 2, profile: { heightCm: 183 }, records: [], exercises: [] };
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function seedIfEmpty() {
  const data = loadData();
  if (!data.records || data.records.length === 0) {
    data.records = SEED_RECORDS.slice();
    if (!data.exercises) data.exercises = [];
    saveData(data);
  }
  if (!data.exercises) {
    data.exercises = [];
    saveData(data);
  }
}

function genId() { return Date.now().toString() + Math.random().toString(36).slice(2, 6); }

// Injection CRUD
function addRecord(rec) {
  const data = loadData();
  rec.id = genId();
  data.records.push(rec);
  saveData(data);
}

function updateRecord(id, fields) {
  const data = loadData();
  const idx = data.records.findIndex(r => r.id === id);
  if (idx >= 0) { data.records[idx] = { ...data.records[idx], ...fields }; saveData(data); }
}

function deleteRecord(id) {
  const data = loadData();
  data.records = data.records.filter(r => r.id !== id);
  saveData(data);
}

// Exercise CRUD
function addExercise(ex) {
  const data = loadData();
  ex.id = genId();
  data.exercises.push(ex);
  saveData(data);
}

function updateExercise(id, fields) {
  const data = loadData();
  const idx = data.exercises.findIndex(e => e.id === id);
  if (idx >= 0) { data.exercises[idx] = { ...data.exercises[idx], ...fields }; saveData(data); }
}

function deleteExercise(id) {
  const data = loadData();
  data.exercises = data.exercises.filter(e => e.id !== id);
  saveData(data);
}

// ================================================
// Sort helpers
// ================================================

function sortRecords(records, field, dir) {
  return [...records].sort((a, b) => {
    let va = a[field], vb = b[field];
    if (field === 'hebrewDate') {
      const cmp = String(va).localeCompare(String(vb), 'he');
      return dir === 'asc' ? cmp : -cmp;
    }
    if (typeof va === 'number' && typeof vb === 'number') {
      return dir === 'asc' ? va - vb : vb - va;
    }
    va = String(va || ''); vb = String(vb || '');
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ================================================
// Dashboard calculations
// ================================================

function sortedByDate(records) {
  return [...records].sort((a, b) => a.gregorianDate < b.gregorianDate ? -1 : 1);
}

function getNextSite(records) {
  if (!records.length) return SITES[0];
  const sorted = sortedByDate(records);
  const last = sorted[sorted.length - 1];
  const idx = SITES.indexOf(last.site);
  return SITES[(idx + 1) % SITES.length];
}

function getNextExpectedDate(records) {
  if (!records.length) return null;
  const sorted = sortedByDate(records);
  return addDays(sorted[sorted.length - 1].gregorianDate, 7);
}

function getWeeklyRate(records) {
  const wRecords = records.filter(r => r.weight);
  if (wRecords.length < 2) return null;
  const sorted = sortedByDate(wRecords);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const daysDiff = (new Date(last.gregorianDate) - new Date(first.gregorianDate)) / 86400000;
  if (daysDiff === 0) return null;
  const totalLoss = first.weight - last.weight;
  const weeks = daysDiff / 7;
  return { rate: Math.round((totalLoss / weeks) * 100) / 100, weeks, totalLoss, firstWeight: first.weight, lastWeight: last.weight, firstDate: first.gregorianDate, lastDate: last.gregorianDate };
}

function getConsistency(records) {
  if (!records.length) return '—';
  const sorted = sortedByDate(records);
  const firstDate = new Date(sorted[0].gregorianDate);
  const today = new Date();
  const totalWeeks = Math.max(1, Math.round((today - firstDate) / (7 * 86400000)));
  const pct = Math.round((records.length / totalWeeks) * 100);
  return Math.min(pct, 100) + '%';
}

function exercisesThisWeek(exercises) {
  const today = isoToday();
  const ws = weekStart(today);
  return exercises.filter(e => e.date >= ws && e.date <= today);
}

function exercisesThisMonth(exercises) {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return exercises.filter(e => e.date.startsWith(prefix));
}

function topActivity(exercises) {
  if (!exercises.length) return '—';
  const counts = {};
  exercises.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
}

// ================================================
// Render Dashboard
// ================================================

function renderOverviewDashboard(records, exercises) {
  const wRecords = records.filter(r => r.weight);
  const sorted = sortedByDate(wRecords);

  // Next injection
  const nextSite = getNextSite(records);
  const nextDate = getNextExpectedDate(records);
  document.getElementById('next-site').textContent = nextSite;
  document.getElementById('next-date').textContent = nextDate ? 'צפוי: ' + fmtDate(nextDate) : '—';

  // BMI
  if (sorted.length) {
    const curWeight = sorted[sorted.length - 1].weight;
    const bmi = calcBMI(curWeight);
    const cat = bmiCategory(bmi);
    const bmiEl = document.getElementById('bmi-value');
    bmiEl.textContent = bmi.toFixed(1);
    bmiEl.style.color = cat.color;
    document.getElementById('bmi-category').textContent = cat.label;
  }

  // Weight trend
  if (sorted.length >= 2) {
    const first = sorted[0], last = sorted[sorted.length - 1];
    const delta = Math.round((last.weight - first.weight) * 10) / 10;
    document.getElementById('current-weight').textContent = last.weight + ' ק"ג';
    const deltaEl = document.getElementById('weight-delta');
    const rate = getWeeklyRate(records);
    const rateStr = rate ? ` (${Math.abs(rate.rate)} ק"ג/שבוע)` : '';
    if (delta < 0) {
      deltaEl.textContent = `ירידה של ${Math.abs(delta)} ק"ג${rateStr}`;
      deltaEl.className = 'card-sub positive';
    } else if (delta > 0) {
      deltaEl.textContent = `עלייה של ${delta} ק"ג${rateStr}`;
      deltaEl.className = 'card-sub negative';
    } else {
      deltaEl.textContent = 'ללא שינוי';
      deltaEl.className = 'card-sub neutral';
    }
  } else if (sorted.length === 1) {
    document.getElementById('current-weight').textContent = sorted[0].weight + ' ק"ג';
    document.getElementById('weight-delta').textContent = 'מדידה ראשונה';
  }

  // Fitness this week
  const thisWeek = exercisesThisWeek(exercises);
  document.getElementById('fitness-week-count').textContent = thisWeek.length + ' אימונים';
  const totalMin = thisWeek.reduce((s, e) => s + (e.durationMin || 0), 0);
  document.getElementById('fitness-week-min').textContent = totalMin ? totalMin + ' דקות סה"כ' : 'טרם נרשם';

  // Recommendations
  const bmiVal = sorted.length ? calcBMI(sorted[sorted.length - 1].weight) : 43;
  renderRecommendations(bmiVal);
}

function renderRecommendations(bmi) {
  const recs = getFitnessRecommendations(bmi);
  const list = document.getElementById('recommendations-list');
  list.innerHTML = recs.map(r =>
    `<div class="rec-item ${r.type}"><span class="rec-icon">${r.icon}</span><span>${r.text}</span></div>`
  ).join('');
}

// ================================================
// Render Injections Dashboard
// ================================================

function renderInjectionsDashboard(records) {
  const sorted = sortedByDate(records);
  const nextSite = getNextSite(records);
  const nextDate = getNextExpectedDate(records);

  document.getElementById('inj-next-site').textContent = nextSite;
  document.getElementById('inj-next-date').textContent = nextDate ? 'צפוי: ' + fmtDate(nextDate) : '—';

  document.getElementById('inj-total').textContent = records.length;
  document.getElementById('inj-since').textContent = sorted.length ? 'מאז ' + fmtDate(sorted[0].gregorianDate) : '—';

  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    document.getElementById('inj-last-site').textContent = last.site;
    const hd = last.hebrewDate ? last.hebrewDate + ' / ' : '';
    document.getElementById('inj-last-date').textContent = hd + fmtDate(last.gregorianDate);
  }

  document.getElementById('inj-consistency').textContent = getConsistency(records);
}

// ================================================
// Render Fitness Dashboard
// ================================================

function renderFitnessDashboard(exercises) {
  const monthEx = exercisesThisMonth(exercises);
  const now = new Date();
  const monthName = monthNameHe(now.getMonth() + 1);

  document.getElementById('fit-month-days').textContent = monthEx.length;
  document.getElementById('fit-month-label').textContent = 'אימונים ב' + monthName;
  const totalMin = monthEx.reduce((s, e) => s + (e.durationMin || 0), 0);
  document.getElementById('fit-month-min').textContent = totalMin || '—';

  const top = topActivity(exercises);
  if (top && top !== '—') {
    document.getElementById('fit-top-activity').textContent = top[0];
    document.getElementById('fit-top-count').textContent = top[1] + ' אימונים';
  } else {
    document.getElementById('fit-top-activity').textContent = '—';
    document.getElementById('fit-top-count').textContent = 'אין נתונים עדיין';
  }
}

// ================================================
// Charts
// ================================================

function destroyChart(inst) { if (inst) { try { inst.destroy(); } catch(e){} } return null; }

function renderOverviewChart(records, exercises) {
  chartOverviewInst = destroyChart(chartOverviewInst);
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (!wRec.length) return;

  const labels = wRec.map(r => r.gregorianDate);
  const weights = wRec.map(r => r.weight);
  const exDates = new Set(exercises.map(e => e.date));

  // Mark exercise days as background lines using annotation plugin
  const annotations = {};
  [...exDates].forEach((d, i) => {
    annotations['ex_' + i] = {
      type: 'line',
      xMin: d,
      xMax: d,
      borderColor: 'rgba(39,174,96,0.3)',
      borderWidth: 2,
      borderDash: [4, 3],
    };
  });

  const ctx = document.getElementById('chartOverview').getContext('2d');
  chartOverviewInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'משקל (ק"ג)',
        data: weights,
        borderColor: '#1a6b8a',
        backgroundColor: 'rgba(26,107,138,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointBackgroundColor: '#1a6b8a',
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true, position: 'top' },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => {
              const iso = items[0].label;
              const rec = wRec.find(r => r.gregorianDate === iso);
              return (rec && rec.hebrewDate ? rec.hebrewDate + ' / ' : '') + fmtDate(iso);
            },
            label: (item) => `משקל: ${item.parsed.y} ק"ג`,
            afterLabel: (item) => {
              const iso = item.label;
              if (exDates.has(iso)) return '🏃 יום כושר!';
              return '';
            }
          }
        },
        annotation: { annotations },
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 11 } } },
        y: {
          ticks: { callback: v => v + ' ק"ג' },
          min: Math.floor(Math.min(...weights) - 2),
          max: Math.ceil(Math.max(...weights) + 1),
        }
      }
    }
  });
}

function renderWeightChart(records) {
  chartWeightInst = destroyChart(chartWeightInst);
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (!wRec.length) return;
  const ctx = document.getElementById('chartWeight').getContext('2d');
  chartWeightInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: wRec.map(r => r.gregorianDate),
      datasets: [{
        label: 'משקל',
        data: wRec.map(r => r.weight),
        borderColor: '#1a6b8a',
        backgroundColor: 'rgba(26,107,138,0.1)',
        borderWidth: 2,
        pointRadius: 5,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true },
        tooltip: {
          rtl: true,
          callbacks: {
            title: items => {
              const iso = items[0].label;
              const r = wRec.find(x => x.gregorianDate === iso);
              return (r && r.hebrewDate ? r.hebrewDate + ' / ' : '') + fmtDate(iso);
            },
            label: item => `${item.parsed.y} ק"ג${wRec[item.dataIndex].weightWithShoes ? ' (עם נעליים)' : ''}`,
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: v => v + ' ק"ג' },
          min: Math.floor(Math.min(...wRec.map(r=>r.weight)) - 2),
        }
      }
    }
  });
}

function renderSitesChart(records) {
  chartSitesInst = destroyChart(chartSitesInst);
  const counts = SITES.map(s => records.filter(r => r.site === s).length);
  const ctx = document.getElementById('chartSites').getContext('2d');
  chartSitesInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: SITES,
      datasets: [{ data: counts, backgroundColor: SITE_COLORS, borderWidth: 2 }]
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: { rtl: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { rtl: true, callbacks: { label: item => `${item.label}: ${item.raw} זריקות` } }
      }
    }
  });
}

function renderTrendChart(records) {
  chartTrendInst = destroyChart(chartTrendInst);
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (wRec.length < 2) return;

  const weights = wRec.map(r => r.weight);
  const moving = weights.map((_, i) => {
    const slice = weights.slice(Math.max(0, i - 1), i + 2);
    return Math.round((slice.reduce((s, v) => s + v, 0) / slice.length) * 10) / 10;
  });

  const ctx = document.getElementById('chartTrend').getContext('2d');
  chartTrendInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: wRec.map(r => r.gregorianDate),
      datasets: [
        {
          label: 'בפועל',
          data: weights,
          borderColor: 'rgba(26,107,138,0.4)',
          borderWidth: 1.5,
          pointRadius: 3,
          tension: 0.2,
          fill: false,
        },
        {
          label: 'ממוצע נע',
          data: moving,
          borderColor: '#e8a020',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.4,
          fill: false,
          borderDash: [5, 3],
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true, position: 'top' },
        tooltip: { rtl: true }
      },
      scales: { y: { ticks: { callback: v => v + ' ק"ג' } } }
    }
  });
}

function renderFitnessChart(exercises) {
  chartFitnessInst = destroyChart(chartFitnessInst);
  if (!exercises.length) return;

  // Group by week (ISO week start)
  const byWeek = {};
  exercises.forEach(e => {
    const ws = weekStart(e.date);
    byWeek[ws] = (byWeek[ws] || 0) + 1;
  });

  const weeks = Object.keys(byWeek).sort();
  const counts = weeks.map(w => byWeek[w]);

  const ctx = document.getElementById('chartFitnessFreq').getContext('2d');
  chartFitnessInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map(fmtDate),
      datasets: [{
        label: 'אימונים בשבוע',
        data: counts,
        backgroundColor: 'rgba(39,174,96,0.7)',
        borderColor: '#27ae60',
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true },
        tooltip: { rtl: true, callbacks: { label: item => `${item.raw} אימונים` } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderCorrelationChart(records, exercises) {
  chartCorrInst = destroyChart(chartCorrInst);
  const canvas = document.getElementById('chartCorrelation');

  // Build weekly data
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (wRec.length < 3) {
    canvas.style.display = 'none';
    return;
  }

  // For each consecutive pair of injections, compute loss and exercise days in that week
  const points = [];
  for (let i = 1; i < wRec.length; i++) {
    const loss = wRec[i - 1].weight - wRec[i].weight;
    const ws = weekStart(wRec[i].gregorianDate);
    const we = wRec[i].gregorianDate;
    const exInWeek = exercises.filter(e => e.date >= ws && e.date <= we).length;
    points.push({ x: exInWeek, y: Math.round(loss * 100) / 100, label: wRec[i].hebrewDate });
  }

  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  chartCorrInst = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'שבועות',
        data: points,
        backgroundColor: SITE_COLORS[0],
        pointRadius: 7,
        pointHoverRadius: 9,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            label: item => {
              const p = points[item.dataIndex];
              return `${p.label}: ${p.x} ימי כושר, ירידה ${p.y} ק"ג`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'ימי כושר בשבוע', font: { size: 12 } },
          ticks: { stepSize: 1 },
          beginAtZero: true,
        },
        y: {
          title: { display: true, text: 'ירידת משקל (ק"ג)', font: { size: 12 } },
        }
      }
    }
  });
}

// ================================================
// Render Tables
// ================================================

function renderInjectionsTable(records) {
  const sorted = sortRecords(records, injSort.field, injSort.dir);
  const tbody = document.getElementById('injections-tbody');
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>אין רשומות עדיין</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(r => `
    <tr>
      <td>${r.hebrewDate || '—'}</td>
      <td>${fmtDate(r.gregorianDate)}</td>
      <td><span class="badge badge-site">${r.site}</span></td>
      <td>${r.dose} מ"ל</td>
      <td>${r.weight ? r.weight + ' ק"ג' : '—'}</td>
      <td class="${r.weightWithShoes ? 'shoes-yes' : 'shoes-no'}">${r.weightWithShoes ? '✓ עם נעליים' : '—'}</td>
      <td class="text-muted">${r.notes || '—'}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" data-id="${r.id}" data-type="inj">עריכה</button>
          <button class="btn-del" data-id="${r.id}" data-type="inj">מחק</button>
        </div>
      </td>
    </tr>
  `).join('');
  updateSortHeaders('injections-table', injSort);
}

function renderExercisesTable(exercises) {
  const sorted = sortRecords(exercises, exSort.field, exSort.dir);
  const tbody = document.getElementById('exercises-tbody');
  if (!exercises.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>לא נרשמו אימונים עדיין</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="badge badge-fitness">${e.type}</span></td>
      <td>${e.durationMin ? e.durationMin + ' דקות' : '—'}</td>
      <td class="text-muted">${e.notes || '—'}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" data-id="${e.id}" data-type="ex">עריכה</button>
          <button class="btn-del" data-id="${e.id}" data-type="ex">מחק</button>
        </div>
      </td>
    </tr>
  `).join('');
  updateSortHeaders('exercises-table', exSort);
}

function updateSortHeaders(tableId, sortState) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortState.field) {
      th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ================================================
// Insights
// ================================================

function renderInsights(records, exercises) {
  renderRateInsights(records);
  renderBMIGoals(records);
  renderCorrelationInsight(records, exercises);
  renderDetailedRecs(records);
}

function renderRateInsights(records) {
  const el = document.getElementById('insights-rate');
  const rate = getWeeklyRate(records);
  if (!rate) {
    el.innerHTML = '<p class="text-muted">נדרשות לפחות 2 מדידות משקל לחישוב קצב</p>';
    return;
  }

  const rateClass = rate.rate >= 0.4 && rate.rate <= 1.2 ? 'rate-good' : rate.rate > 1.2 ? 'rate-warn' : 'rate-bad';
  const rateLabel = rate.rate >= 0.4 && rate.rate <= 1.2 ? '← מצוין!' : rate.rate > 1.2 ? '← מהיר מדי' : '← איטי';

  el.innerHTML = `
    <div class="rate-row">
      <span class="rate-label">ירידה כוללת</span>
      <span class="rate-value text-success">${rate.totalLoss.toFixed(1)} ק"ג</span>
    </div>
    <div class="rate-row">
      <span class="rate-label">תקופת מעקב</span>
      <span class="rate-value">${rate.weeks.toFixed(1)} שבועות</span>
    </div>
    <div class="rate-row">
      <span class="rate-label">קצב שבועי ממוצע</span>
      <span class="rate-value ${rateClass}">${rate.rate.toFixed(2)} ק"ג/שבוע ${rateLabel}</span>
    </div>
    <div class="rate-row">
      <span class="rate-label">קצב חודשי</span>
      <span class="rate-value">${(rate.rate * 4.33).toFixed(1)} ק"ג/חודש</span>
    </div>
    <div class="rate-row">
      <span class="rate-label">משקל פתיחה</span>
      <span class="rate-value">${rate.firstWeight} ק"ג (${fmtDate(rate.firstDate)})</span>
    </div>
    <div class="rate-row">
      <span class="rate-label">משקל נוכחי</span>
      <span class="rate-value">${rate.lastWeight} ק"ג</span>
    </div>
  `;
}

function renderBMIGoals(records) {
  const el = document.getElementById('insights-bmi-goals');
  const wRec = records.filter(r => r.weight);
  if (!wRec.length) {
    el.innerHTML = '<p class="text-muted">נדרשת לפחות מדידת משקל אחת</p>';
    return;
  }
  const sorted = sortedByDate(wRec);
  const currentWeight = sorted[sorted.length - 1].weight;
  const startWeight   = sorted[0].weight;
  const rate = getWeeklyRate(records);

  const goals = [
    { bmi: 40, label: 'BMI 40 — שלב 3 לשלב 2' },
    { bmi: 35, label: 'BMI 35 — שלב 2 לשלב 1' },
    { bmi: 30, label: 'BMI 30 — יציאה מהשמנה חמורה' },
    { bmi: 25, label: 'BMI 25 — משקל תקין' },
  ];

  const currentBMI = calcBMI(currentWeight);

  el.innerHTML = goals.map(g => {
    const targetW = weightForBMI(g.bmi);
    const needed  = currentWeight - targetW;
    const done    = startWeight > targetW ? Math.max(0, (startWeight - currentWeight) / (startWeight - targetW)) : 1;
    const pct     = Math.min(100, Math.round(done * 100));
    const weeksLeft = rate && rate.rate > 0 ? Math.round(Math.max(0, needed) / rate.rate) : null;
    const achieved  = currentWeight <= targetW;

    return `
      <div class="bmi-goal">
        <div class="bmi-goal-header">
          <span class="bmi-goal-label">${achieved ? '✅ ' : ''}${g.label}</span>
          <span class="bmi-goal-meta">${targetW} ק"ג</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${achieved ? 'done' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="bmi-goal-sub">
          <span>${pct}% הושג</span>
          <span>${achieved ? 'הגעת ליעד! 🎉' : (weeksLeft !== null ? `~${weeksLeft} שבועות נותרו` : (needed > 0 ? `${needed.toFixed(1)} ק"ג נותרו` : 'הגעת!'))}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderCorrelationInsight(records, exercises) {
  const el = document.getElementById('insights-correlation');
  const wRec = sortedByDate(records.filter(r => r.weight));

  if (wRec.length < 3 || exercises.length < 2) {
    el.innerHTML = `<div class="corr-note warn">נדרשות לפחות 3 מדידות משקל ו-2 אימונים לחישוב הקורלציה. המשך לתעד!</div>`;
    renderCorrelationChart(records, exercises);
    return;
  }

  // Compute averages
  const withEx = [], withoutEx = [];
  for (let i = 1; i < wRec.length; i++) {
    const loss = wRec[i - 1].weight - wRec[i].weight;
    const ws   = weekStart(wRec[i].gregorianDate);
    const exN  = exercises.filter(e => e.date >= ws && e.date <= wRec[i].gregorianDate).length;
    if (exN > 0) withEx.push(loss); else withoutEx.push(loss);
  }

  const avg = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : null;
  const avgWith    = avg(withEx);
  const avgWithout = avg(withoutEx);

  let corrText = '';
  if (avgWith && avgWithout) {
    const diff = (parseFloat(avgWith) - parseFloat(avgWithout)).toFixed(2);
    corrText = diff > 0
      ? `בשבועות עם אימון הירידה הממוצעת הייתה <strong>${avgWith} ק"ג</strong>, לעומת <strong>${avgWithout} ק"ג</strong> בשבועות ללא כושר — פרש של <strong>${diff} ק"ג</strong> לטובת שבועות הכושר!`
      : `נתונים עדיין מועטים לקביעת קורלציה ברורה. המשך לתעד לתוצאות טובות יותר.`;
  } else if (avgWith) {
    corrText = `עד כה יש נתוני אימון לחלק מהשבועות. ממוצע ירידה בשבועות כושר: <strong>${avgWith} ק"ג</strong>.`;
  } else {
    corrText = 'עדיין אין מספיק שבועות עם אימונים לחישוב. הוסף אימונים!';
  }

  el.innerHTML = `<div class="corr-note">${corrText}</div>`;
  renderCorrelationChart(records, exercises);
}

function renderDetailedRecs(records) {
  const el = document.getElementById('insights-recommendations');
  const wRec = sortedByDate(records.filter(r => r.weight));
  const bmi  = wRec.length ? calcBMI(wRec[wRec.length - 1].weight) : 43;
  const rate = getWeeklyRate(records);

  const rateText = rate
    ? rate.rate >= 0.4 && rate.rate <= 1.2
      ? `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) מצוין — המשך כך!`
      : rate.rate > 1.2
        ? `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) מהיר מהרצוי — וודא שאתה אוכל מספיק חלבון ולא מאבד מסת שריר.`
        : `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) איטי מהרצוי — שקול להגביר פעילות גופנית ולבדוק תזונה.`
    : 'אין עדיין מספיק נתונים לניתוח קצב.';

  el.innerHTML = `
    <div class="insight-rec-card">
      <div class="insight-rec-title">📅 תזמון ביחס לזריקה</div>
      <div class="insight-rec-body">הזריקה השבועית ניתנת בערב שבת. מומלץ להימנע מאימון אינטנסיבי ביום הזריקה עצמו ולנוח. הימים המומלצים לאימון: ראשון–חמישי.</div>
    </div>
    <div class="insight-rec-card">
      <div class="insight-rec-title">🎯 יעד שבועי מומלץ</div>
      <div class="insight-rec-body">${bmi >= 40
        ? '3–4 אימונים בשבוע, 20–30 דקות כל אחד. התחל לאט ובנה הדרגה על פני שבועות.'
        : bmi >= 35
          ? '4–5 אימונים בשבוע, 30–45 דקות כל אחד. שלב קרדיו עם כוח.'
          : '5 אימונים בשבוע, 45–60 דקות. גיוון בין פעילויות שונות.'
      }</div>
    </div>
    <div class="insight-rec-card">
      <div class="insight-rec-title">⚖️ ניתוח קצב ירידת משקל</div>
      <div class="insight-rec-body">${rateText}</div>
    </div>
    <div class="insight-rec-card">
      <div class="insight-rec-title">👟 הערה לגבי מדידת משקל</div>
      <div class="insight-rec-body">למדידה עקבית — מדוד תמיד באותם תנאים (בוקר, לפני ארוחה, ללא נעליים). כשמדדת עם נעליים, סמן זאת — הנתונים מסוננים בהתאם בגרפים.</div>
    </div>
    <div class="insight-rec-card">
      <div class="insight-rec-title">💉 הזריקה השבועית</div>
      <div class="insight-rec-body">הזריקה מסתובבת בין 4 אתרים (רגל ימין → רגל שמאל → יד ימין → יד שמאל). רוטציה זו חשובה להפחתת גירוי מקומי ושיפור הספיגה.</div>
    </div>
  `;
}

// ================================================
// Refresh All
// ================================================

function refreshAll() {
  const data = loadData();
  const { records, exercises } = data;

  renderOverviewDashboard(records, exercises);
  renderOverviewChart(records, exercises);

  renderInjectionsDashboard(records);
  renderWeightChart(records);
  renderSitesChart(records);
  renderTrendChart(records);
  renderInjectionsTable(records);

  renderFitnessDashboard(exercises);
  renderFitnessChart(exercises);
  renderExercisesTable(exercises);

  renderInsights(records, exercises);
}

// ================================================
// Forms
// ================================================

function openInjectionForm(record) {
  editingInjectionId = record ? record.id : null;
  document.getElementById('injection-form-title').textContent = record ? 'עריכת זריקה' : 'הוספת זריקה';
  document.getElementById('injection-edit-id').value = record ? record.id : '';
  document.getElementById('inj-hebrew-date').value = record ? (record.hebrewDate || '') : '';
  document.getElementById('inj-gregorian-date').value = record ? (record.gregorianDate || '') : isoToday();
  document.getElementById('inj-site').value = record ? record.site : getNextSite(loadData().records);
  document.getElementById('inj-dose').value = record ? record.dose : 0.25;
  document.getElementById('inj-weight').value = record ? (record.weight || '') : '';
  document.getElementById('inj-shoes').checked = record ? !!record.weightWithShoes : false;
  document.getElementById('inj-notes').value = record ? (record.notes || '') : '';

  const section = document.getElementById('injection-form-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Switch to injections tab
  switchTab('injections');
}

function closeInjectionForm() {
  document.getElementById('injection-form-section').style.display = 'none';
  editingInjectionId = null;
}

function openExerciseForm(ex) {
  editingExerciseId = ex ? ex.id : null;
  document.getElementById('exercise-form-title').textContent = ex ? 'עריכת אימון' : 'הוספת אימון';
  document.getElementById('exercise-edit-id').value = ex ? ex.id : '';
  document.getElementById('ex-date').value = ex ? ex.date : isoToday();
  document.getElementById('ex-type').value = ex ? ex.type : '';
  document.getElementById('ex-duration').value = ex ? (ex.durationMin || '') : '';
  document.getElementById('ex-notes').value = ex ? (ex.notes || '') : '';

  const section = document.getElementById('exercise-form-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  switchTab('fitness');
}

function closeExerciseForm() {
  document.getElementById('exercise-form-section').style.display = 'none';
  editingExerciseId = null;
}

// ================================================
// Modal
// ================================================

function showConfirm(message, onConfirm) {
  document.getElementById('modal-text').textContent = message;
  document.getElementById('modal-overlay').style.display = 'flex';
  pendingDeleteFn = onConfirm;
}

function hideModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  pendingDeleteFn = null;
}

// ================================================
// Tabs
// ================================================

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === 'tab-' + tabId);
  });
}

// ================================================
// Export
// ================================================

function exportJSON() {
  const data = loadData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `natuni-health-${isoToday()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ================================================
// Event Listeners
// ================================================

document.addEventListener('DOMContentLoaded', () => {

  // Chart.js RTL defaults
  Chart.defaults.font.family = "'Segoe UI', 'Arial Hebrew', Arial, sans-serif";
  Chart.defaults.plugins.legend.rtl = true;
  Chart.defaults.plugins.tooltip.rtl = true;

  // Seed & initial render
  seedIfEmpty();
  refreshAll();

  // ---- Tabs ----
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ---- Header buttons ----
  document.getElementById('btn-export').addEventListener('click', exportJSON);

  document.getElementById('btn-add-injection').addEventListener('click', () => openInjectionForm(null));
  document.getElementById('btn-add-injection-2').addEventListener('click', () => openInjectionForm(null));

  document.getElementById('btn-add-exercise').addEventListener('click', () => openExerciseForm(null));
  document.getElementById('btn-add-exercise-2').addEventListener('click', () => openExerciseForm(null));

  // ---- Injection Form ----
  document.getElementById('btn-close-injection-form').addEventListener('click', closeInjectionForm);
  document.getElementById('btn-cancel-injection').addEventListener('click', closeInjectionForm);

  document.getElementById('inj-gregorian-date').addEventListener('change', (e) => {
    const hebrewField = document.getElementById('inj-hebrew-date');
    if (!hebrewField.value) {
      hebrewField.value = autoFillHebrewDate(e.target.value);
    }
  });

  document.getElementById('injection-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const record = {
      hebrewDate:      document.getElementById('inj-hebrew-date').value.trim(),
      gregorianDate:   document.getElementById('inj-gregorian-date').value,
      site:            document.getElementById('inj-site').value,
      dose:            parseFloat(document.getElementById('inj-dose').value) || 0.25,
      weight:          parseFloat(document.getElementById('inj-weight').value) || null,
      weightWithShoes: document.getElementById('inj-shoes').checked,
      notes:           document.getElementById('inj-notes').value.trim(),
    };
    if (!record.gregorianDate || !record.site) {
      alert('נא למלא תאריך לועזי ואתר זריקה');
      return;
    }
    if (editingInjectionId) {
      updateRecord(editingInjectionId, record);
    } else {
      addRecord(record);
    }
    closeInjectionForm();
    refreshAll();
  });

  // ---- Exercise Form ----
  document.getElementById('btn-close-exercise-form').addEventListener('click', closeExerciseForm);
  document.getElementById('btn-cancel-exercise').addEventListener('click', closeExerciseForm);

  document.getElementById('exercise-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ex = {
      date:        document.getElementById('ex-date').value,
      type:        document.getElementById('ex-type').value,
      durationMin: parseInt(document.getElementById('ex-duration').value) || null,
      notes:       document.getElementById('ex-notes').value.trim(),
    };
    if (!ex.date || !ex.type) {
      alert('נא למלא תאריך וסוג פעילות');
      return;
    }
    if (editingExerciseId) {
      updateExercise(editingExerciseId, ex);
    } else {
      addExercise(ex);
    }
    closeExerciseForm();
    refreshAll();
  });

  // ---- Table actions (event delegation) ----
  document.getElementById('injections-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-edit')) {
      const rec = loadData().records.find(r => r.id === id);
      if (rec) openInjectionForm(rec);
    } else if (btn.classList.contains('btn-del')) {
      showConfirm('האם למחוק רשומת זריקה זו?', () => {
        deleteRecord(id);
        refreshAll();
      });
    }
  });

  document.getElementById('exercises-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-edit')) {
      const ex = loadData().exercises.find(x => x.id === id);
      if (ex) openExerciseForm(ex);
    } else if (btn.classList.contains('btn-del')) {
      showConfirm('האם למחוק רשומת אימון זו?', () => {
        deleteExercise(id);
        refreshAll();
      });
    }
  });

  // ---- Sort headers ----
  document.getElementById('injections-table').querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      if (injSort.field === th.dataset.sort) {
        injSort.dir = injSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        injSort.field = th.dataset.sort;
        injSort.dir   = 'asc';
      }
      renderInjectionsTable(loadData().records);
    });
  });

  document.getElementById('exercises-table').querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      if (exSort.field === th.dataset.sort) {
        exSort.dir = exSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        exSort.field = th.dataset.sort;
        exSort.dir   = 'asc';
      }
      renderExercisesTable(loadData().exercises);
    });
  });

  // ---- Modal ----
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (pendingDeleteFn) pendingDeleteFn();
    hideModal();
  });
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) hideModal();
  });

  // ---- Hebrew date auto-fill on load ----
  document.getElementById('inj-hebrew-date').addEventListener('focus', () => {
    const dateField = document.getElementById('inj-gregorian-date');
    const hebrewField = document.getElementById('inj-hebrew-date');
    if (!hebrewField.value && dateField.value) {
      hebrewField.value = autoFillHebrewDate(dateField.value);
    }
  });
});
