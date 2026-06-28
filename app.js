'use strict';

// ===== Constants =====
const STORAGE_KEY = 'natuni_data';
const HEIGHT_M    = 1.83;
const SITES       = ['רגל ימין', 'רגל שמאל', 'יד ימין', 'יד שמאל'];
const SITE_COLORS = ['#1a6b8a', '#2a90b8', '#27ae60', '#e8a020'];
const DOSES       = [0.25, 0.5, 1, 1.7, 2.4];

const SEED_RECORDS = [
  { id: '1748995200000', hebrewDate: "כ' בסיוון תשפ\"ו",  gregorianDate: '2026-06-05', site: 'רגל ימין',  dose: 0.25, weight: 144.4, weightWithShoes: true,  notes: '' },
  { id: '1749600000000', hebrewDate: 'כ"ז בסיוון תשפ"ו', gregorianDate: '2026-06-12', site: 'רגל שמאל', dose: 0.25, weight: 143.0, weightWithShoes: false, notes: '' },
  { id: '1750204800000', hebrewDate: "ד' בתמוז תשפ\"ו",   gregorianDate: '2026-06-19', site: 'יד ימין',   dose: 0.25, weight: 143.4, weightWithShoes: false, notes: '' },
  { id: '1750809600000', hebrewDate: 'י"א בתמוז תשפ"ו',  gregorianDate: '2026-06-26', site: 'יד שמאל',  dose: 0.25, weight: 141.5, weightWithShoes: false, notes: '' },
];

const SEED_PURCHASES = [
  {
    id: '1748822400000',
    hebrewDate:    'י"ז בסיוון תשפ"ו',
    gregorianDate: '2026-06-02',
    store:         'סופר פארם ח.המפרץ 38',
    amount:        676.69,
    paymentMethod: 'Google Pay MC',
    notes:         '',
  },
];

// ===== Chart instances =====
let chartOverviewInst   = null;
let chartWeightInst     = null;
let chartSitesInst      = null;
let chartTrendInst      = null;
let chartFitnessInst    = null;
let chartCorrInst       = null;

// ===== Sort state =====
let injSort      = { field: 'gregorianDate', dir: 'desc' };
let exSort       = { field: 'date', dir: 'desc' };
let purchaseSort = { field: 'gregorianDate', dir: 'desc' };

// ===== Delete callback =====
let pendingDeleteFn = null;

// ===== Editing IDs =====
let editingInjectionId = null;
let editingExerciseId  = null;
let editingPurchaseId  = null;

// ================================================
// Hebrew Calendar (Dershowitz-Reingold algorithm)
// ================================================

// Gematria letter values (for both encoding and decoding)
const GEMATRIA_MAP = {
  'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,
  'י':10,'כ':20,'ל':30,'מ':40,'נ':50,'ס':60,'ע':70,'פ':80,'צ':90,
  'ק':100,'ר':200,'ש':300,'ת':400
};

// All letter+value pairs sorted descending (for numToHebrew and yearToHebrew)
const GEMATRIA_PAIRS = [
  [400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],
  [90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],
  [40,'מ'],[30,'ל'],[20,'כ'],[10,'י'],
  [9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],
  [4,'ד'],[3,'ג'],[2,'ב'],[1,'א'],
];

function numToHebrew(n) {
  if (n <= 0 || n > 30) return String(n);
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  const ones = ['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
  const tens = ['','י','כ','ל'];
  const t = Math.floor(n / 10), o = n % 10;
  if (t === 0) return ones[o] + '׳';
  if (o === 0) return tens[t] + '׳';
  return tens[t] + '״' + ones[o];
}

// Convert Hebrew year number → Hebrew gematria string (e.g. 5786 → 'תשפ"ו')
function yearToHebrew(year) {
  let n = year % 1000;
  let result = '';
  for (const [val, letter] of GEMATRIA_PAIRS) {
    while (n >= val) {
      if (n === 15) { result += 'טו'; n = 0; break; }
      if (n === 16) { result += 'טז'; n = 0; break; }
      result += letter;
      n -= val;
    }
    if (n === 0) break;
  }
  if (result.length <= 1) return result + '׳';
  return result.slice(0, -1) + '״' + result.slice(-1);
}

// Convert gematria string → number (strips punctuation first)
function hebrewGematriaToNum(str) {
  const clean = str.replace(/[׳״'"]/g, '');
  return [...clean].reduce((s, ch) => s + (GEMATRIA_MAP[ch] || 0), 0);
}

const HEB_MONTHS      = ['תשרי','חשוון','כסלו','טבת','שבט','אדר','ניסן','אייר','סיוון','תמוז','אב','אלול'];
const HEB_MONTHS_LEAP = ['תשרי','חשוון','כסלו','טבת','שבט',"אדר א'",'אדר ב\'','ניסן','אייר','סיוון','תמוז','אב','אלול'];

function isHebrewLeapYear(y) { return ((7 * y + 1) % 19) < 7; }
function hebrewMonthsInYear(y) { return isHebrewLeapYear(y) ? 13 : 12; }

function hebrewElapsedDays(y) {
  const monthsElapsed = Math.floor((235 * y - 234) / 19);
  const parts = 12084 + 13753 * monthsElapsed;
  let day = monthsElapsed * 29 + Math.floor(parts / 25920);
  if (((3 * (day + 1)) % 7) < 3) day++;
  return day;
}

function hebrewYearDays(y) { return hebrewElapsedDays(y + 1) - hebrewElapsedDays(y); }

function hebrewMonthDays(y, m) {
  const leap = isHebrewLeapYear(y);
  const months = leap ? 13 : 12;
  const base = [30,29,30,29,30,29,30,29,30,29,30,29,30];
  if (m === 8 && hebrewYearDays(y) % 10 !== 5) return 29;
  if (m === 9 && hebrewYearDays(y) % 10 === 3) return 30;
  if (m === 6 && !leap) return 0;
  if (m > months) return 0;
  return base[m - 1];
}

function accumulatedDays(year, month) {
  let days = 0;
  for (let m = 1; m < month; m++) days += hebrewMonthDays(year, m);
  return days;
}

function gregorianToJD(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
       + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function jdToGregorian(jd) {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(b * 146097 / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day:   e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year:  b * 100 + d - 4800 + Math.floor(m / 10),
  };
}

function jdToHebrew(jd) {
  const jd0 = Math.floor(jd) + 0.5;
  let year = Math.floor((jd0 - 347999) / 365.25);
  while (hebrewElapsedDays(year + 1) <= jd0 - 347998) year++;
  const yearStart = hebrewElapsedDays(year) + 347998;
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

function gregorianToHebrew(year, month, day) {
  return jdToHebrew(gregorianToJD(year, month, day));
}

// Hebrew date object → "י"א בתמוז תשפ"ו" (full format with year)
function formatHebrewDate(h) {
  const leap = isHebrewLeapYear(h.year);
  const months = leap ? HEB_MONTHS_LEAP : HEB_MONTHS;
  const monthName = months[h.month - 1] || '';
  return numToHebrew(h.day) + ' ב' + monthName + ' ' + yearToHebrew(h.year);
}

// Short Hebrew date for chart axis labels: "כ' סיוון" (no year)
function hebrewDateShort(isoStr) {
  if (!isoStr) return '';
  try {
    const [y, m, d] = isoStr.split('-').map(Number);
    const h = gregorianToHebrew(y, m, d);
    const leap = isHebrewLeapYear(h.year);
    const months = leap ? HEB_MONTHS_LEAP : HEB_MONTHS;
    return numToHebrew(h.day) + ' ' + months[h.month - 1];
  } catch (e) { return isoStr; }
}

// Gregorian ISO string → full Hebrew date string
function autoFillHebrewDate(gregorianStr) {
  if (!gregorianStr) return '';
  try {
    const [y, m, d] = gregorianStr.split('-').map(Number);
    return formatHebrewDate(gregorianToHebrew(y, m, d));
  } catch (e) { return ''; }
}

// Parse "כ' בסיוון תשפ"ו" or "י"א בתמוז תשפ"ו" → ISO date string or null
function hebrewToGregorianISO(text) {
  if (!text) return null;
  try {
    // Normalize: unify quote chars, trim
    const norm = text.trim().replace(/[''׳]/g, "'").replace(/["״]/g, '"');
    // Split on spaces: expect [day, "ב"+month, year] — at minimum 3 parts
    const parts = norm.split(/\s+/);
    if (parts.length < 3) return null;

    const dayStr   = parts[0];
    const monthStr = parts[1]; // "בסיוון" / "בתמוז" etc.
    const yearStr  = parts[2];

    if (!monthStr.startsWith('ב')) return null;
    const monthName = monthStr.slice(1); // remove "ב"

    // Find month index (1-based)
    let monthIdx = HEB_MONTHS.indexOf(monthName);
    if (monthIdx < 0) monthIdx = HEB_MONTHS_LEAP.indexOf(monthName);
    if (monthIdx < 0) return null;
    const hebrewMonth = monthIdx + 1;

    const hebrewDay  = hebrewGematriaToNum(dayStr);
    const hebrewYear = hebrewGematriaToNum(yearStr) + 5000;

    if (!hebrewDay || !hebrewYear || hebrewYear < 5700 || hebrewYear > 6000) return null;

    // Hebrew date → JD → Gregorian
    const jd = hebrewElapsedDays(hebrewYear) + 347998 + accumulatedDays(hebrewYear, hebrewMonth) + hebrewDay - 1;
    const g  = jdToGregorian(jd);
    return `${g.year}-${String(g.month).padStart(2,'0')}-${String(g.day).padStart(2,'0')}`;
  } catch (e) { return null; }
}

// ===== Format Gregorian date in Hebrew-style display =====
function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const [y, m, d] = isoStr.split('-');
  return `${Number(d)} ב${monthNameHe(Number(m))} ${y}`;
}

function monthNameHe(m) {
  const n = ['','ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return n[m] || '';
}

function addDays(isoStr, days) {
  const d = new Date(isoStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

function weekStart(isoStr) {
  const d = new Date(isoStr);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

// ===== BMI =====
function calcBMI(weight) { return Math.round((weight / (HEIGHT_M * HEIGHT_M)) * 10) / 10; }

function bmiCategory(bmi) {
  if (bmi >= 40) return { label: 'השמנת יתר חמורה (שלב 3)', color: '#c0392b' };
  if (bmi >= 35) return { label: 'השמנת יתר (שלב 2)',        color: '#c0392b' };
  if (bmi >= 30) return { label: 'השמנת יתר (שלב 1)',        color: '#e67e22' };
  if (bmi >= 25) return { label: 'עודף משקל',                 color: '#e67e22' };
  return               { label: 'משקל תקין',                   color: '#27ae60' };
}

function weightForBMI(targetBmi) { return Math.round(targetBmi * HEIGHT_M * HEIGHT_M * 10) / 10; }

// ===== Last used dose =====
function getLastUsedDose(records) {
  if (!records.length) return 0.25;
  const sorted = sortedByDate(records);
  return sorted[sorted.length - 1].dose || 0.25;
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
    { type: 'do', icon: '🏃', text: 'שמור על פעילות גופנית מגוונת — קרדיו + כוח' },
    { type: 'do', icon: '💪', text: 'אימוני כוח מלאים 3 פעמים בשבוע' },
    { type: 'do', icon: '⚡', text: 'ניתן להוסיף HIIT ואינטרוולים לגיוון' },
  ];
}

// ================================================
// Data Layer
// ================================================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (!data.exercises)  data.exercises  = [];
      if (!data.purchases)  data.purchases  = [];
      return data;
    }
  } catch (e) { /* corrupt — reset */ }
  return { version: 3, profile: { heightCm: 183 }, records: [], exercises: [], purchases: [] };
}

function saveData(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

function seedIfEmpty() {
  const data = loadData();
  let changed = false;
  if (!data.records || data.records.length === 0) {
    data.records = SEED_RECORDS.slice();
    changed = true;
  }
  if (!data.exercises)                             { data.exercises  = []; changed = true; }
  if (!data.purchases || data.purchases.length === 0) {
    data.purchases = SEED_PURCHASES.slice();
    changed = true;
  }
  if (changed) saveData(data);
}

function genId() { return Date.now().toString() + Math.random().toString(36).slice(2, 6); }

// Injection CRUD
function addRecord(rec)            { const d = loadData(); rec.id = genId(); d.records.push(rec); saveData(d); }
function updateRecord(id, fields)  { const d = loadData(); const i = d.records.findIndex(r => r.id === id); if (i>=0){ d.records[i]={...d.records[i],...fields}; saveData(d); } }
function deleteRecord(id)          { const d = loadData(); d.records = d.records.filter(r => r.id !== id); saveData(d); }

// Exercise CRUD
function addExercise(ex)           { const d = loadData(); ex.id = genId(); d.exercises.push(ex); saveData(d); }
function updateExercise(id, fields){ const d = loadData(); const i = d.exercises.findIndex(e => e.id === id); if (i>=0){ d.exercises[i]={...d.exercises[i],...fields}; saveData(d); } }
function deleteExercise(id)        { const d = loadData(); d.exercises = d.exercises.filter(e => e.id !== id); saveData(d); }

// Purchase CRUD
function addPurchase(p)            { const d = loadData(); p.id = genId(); d.purchases.push(p); saveData(d); }
function updatePurchase(id, fields){ const d = loadData(); const i = d.purchases.findIndex(p => p.id === id); if (i>=0){ d.purchases[i]={...d.purchases[i],...fields}; saveData(d); } }
function deletePurchase(id)        { const d = loadData(); d.purchases = d.purchases.filter(p => p.id !== id); saveData(d); }

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
    if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
    va = String(va || ''); vb = String(vb || '');
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ================================================
// Dashboard calculations
// ================================================

function sortedByDate(records) {
  return [...records].sort((a, b) => (a.gregorianDate || a.date) < (b.gregorianDate || b.date) ? -1 : 1);
}

function getNextSite(records) {
  if (!records.length) return SITES[0];
  const sorted = sortedByDate(records);
  return SITES[(SITES.indexOf(sorted[sorted.length - 1].site) + 1) % SITES.length];
}

function getNextExpectedDate(records) {
  if (!records.length) return null;
  return addDays(sortedByDate(records)[records.length - 1].gregorianDate, 7);
}

function getWeeklyRate(records) {
  const wRec = records.filter(r => r.weight);
  if (wRec.length < 2) return null;
  const sorted = sortedByDate(wRec);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const days = (new Date(last.gregorianDate) - new Date(first.gregorianDate)) / 86400000;
  if (!days) return null;
  const totalLoss = first.weight - last.weight;
  const weeks = days / 7;
  return { rate: Math.round(totalLoss / weeks * 100) / 100, weeks, totalLoss, firstWeight: first.weight, lastWeight: last.weight, firstDate: first.gregorianDate, lastDate: last.gregorianDate };
}

function getConsistency(records) {
  if (!records.length) return '—';
  const sorted = sortedByDate(records);
  const totalWeeks = Math.max(1, Math.round((new Date() - new Date(sorted[0].gregorianDate)) / (7 * 86400000)));
  return Math.min(100, Math.round(records.length / totalWeeks * 100)) + '%';
}

function exercisesThisWeek(exercises) {
  const today = isoToday(), ws = weekStart(today);
  return exercises.filter(e => e.date >= ws && e.date <= today);
}

function exercisesThisMonth(exercises) {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return exercises.filter(e => e.date.startsWith(prefix));
}

function topActivity(exercises) {
  if (!exercises.length) return null;
  const counts = {};
  exercises.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
}

// ================================================
// Render Dashboards
// ================================================

function renderOverviewDashboard(records, exercises) {
  const wRec  = sortedByDate(records.filter(r => r.weight));
  const nextSite = getNextSite(records);
  const nextDate = getNextExpectedDate(records);
  document.getElementById('next-site').textContent = nextSite;
  document.getElementById('next-date').textContent = nextDate ? 'צפוי: ' + autoFillHebrewDate(nextDate) : '—';

  if (wRec.length) {
    const cur = wRec[wRec.length - 1].weight;
    const bmi = calcBMI(cur);
    const cat = bmiCategory(bmi);
    const el  = document.getElementById('bmi-value');
    el.textContent  = bmi.toFixed(1);
    el.style.color  = cat.color;
    document.getElementById('bmi-category').textContent = cat.label;
  }

  if (wRec.length >= 2) {
    const delta = Math.round((wRec[wRec.length-1].weight - wRec[0].weight) * 10) / 10;
    document.getElementById('current-weight').textContent = wRec[wRec.length-1].weight + ' ק"ג';
    const el  = document.getElementById('weight-delta');
    const rate = getWeeklyRate(records);
    const rs  = rate ? ` (${Math.abs(rate.rate)} ק"ג/שבוע)` : '';
    if (delta < 0) { el.textContent = `ירידה של ${Math.abs(delta)} ק"ג${rs}`; el.className = 'card-sub positive'; }
    else if (delta > 0) { el.textContent = `עלייה של ${delta} ק"ג${rs}`; el.className = 'card-sub negative'; }
    else { el.textContent = 'ללא שינוי'; el.className = 'card-sub neutral'; }
  } else if (wRec.length) {
    document.getElementById('current-weight').textContent = wRec[0].weight + ' ק"ג';
    document.getElementById('weight-delta').textContent   = 'מדידה ראשונה';
  }

  const thisWeek = exercisesThisWeek(exercises);
  document.getElementById('fitness-week-count').textContent = thisWeek.length + ' אימונים';
  const totalMin = thisWeek.reduce((s, e) => s + (e.durationMin || 0), 0);
  document.getElementById('fitness-week-min').textContent = totalMin ? totalMin + ' דקות סה"כ' : 'טרם נרשם';

  const bmiVal = wRec.length ? calcBMI(wRec[wRec.length-1].weight) : 43;
  renderRecommendations(bmiVal);
}

function renderRecommendations(bmi) {
  const list = document.getElementById('recommendations-list');
  list.innerHTML = getFitnessRecommendations(bmi).map(r =>
    `<div class="rec-item ${r.type}"><span class="rec-icon">${r.icon}</span><span>${r.text}</span></div>`
  ).join('');
}

function renderInjectionsDashboard(records) {
  const sorted   = sortedByDate(records);
  const nextSite = getNextSite(records);
  const nextDate = getNextExpectedDate(records);
  document.getElementById('inj-next-site').textContent = nextSite;
  document.getElementById('inj-next-date').textContent = nextDate ? 'צפוי: ' + autoFillHebrewDate(nextDate) : '—';
  document.getElementById('inj-total').textContent     = records.length;
  document.getElementById('inj-since').textContent     = sorted.length ? 'מאז ' + autoFillHebrewDate(sorted[0].gregorianDate) : '—';
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    document.getElementById('inj-last-site').textContent = last.site;
    document.getElementById('inj-last-date').textContent = last.hebrewDate || autoFillHebrewDate(last.gregorianDate);
  }
  document.getElementById('inj-consistency').textContent = getConsistency(records);
}

function renderFitnessDashboard(exercises) {
  const monthEx = exercisesThisMonth(exercises);
  const now = new Date();
  document.getElementById('fit-month-days').textContent  = monthEx.length;
  document.getElementById('fit-month-label').textContent = 'אימונים ב' + monthNameHe(now.getMonth() + 1);
  document.getElementById('fit-month-min').textContent   = monthEx.reduce((s,e) => s+(e.durationMin||0), 0) || '—';
  const top = topActivity(exercises);
  if (top) {
    document.getElementById('fit-top-activity').textContent = top[0];
    document.getElementById('fit-top-count').textContent    = top[1] + ' אימונים';
  } else {
    document.getElementById('fit-top-activity').textContent = '—';
    document.getElementById('fit-top-count').textContent    = 'אין נתונים עדיין';
  }
}

function renderPurchasesDashboard(purchases) {
  const sorted = sortedByDate(purchases);
  const total  = purchases.reduce((s, p) => s + (p.amount || 0), 0);
  const avg    = purchases.length ? Math.round(total / purchases.length * 100) / 100 : 0;

  const lastEl = document.getElementById('pur-last-date');
  const totEl  = document.getElementById('pur-total-spent');
  const avgEl  = document.getElementById('pur-avg');
  const lastStoreEl = document.getElementById('pur-last-store');

  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    if (lastEl) lastEl.textContent = last.hebrewDate || fmtDate(last.gregorianDate);
    if (lastStoreEl) lastStoreEl.textContent = last.store || '—';
  } else {
    if (lastEl) lastEl.textContent = '—';
    if (lastStoreEl) lastStoreEl.textContent = '—';
  }
  if (totEl) totEl.textContent = '₪' + total.toFixed(2);
  if (avgEl) avgEl.textContent = purchases.length ? '₪' + avg.toFixed(2) : '—';
}

// ================================================
// Charts
// ================================================

function destroyChart(inst) { if (inst) { try { inst.destroy(); } catch(e){} } return null; }

function renderOverviewChart(records, exercises) {
  chartOverviewInst = destroyChart(chartOverviewInst);
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (!wRec.length) return;

  // Build weight lookup and exercise date set
  const weightByDate = {};
  wRec.forEach(r => { weightByDate[r.gregorianDate] = r; });
  const exDates = new Set(exercises.map(e => e.date));

  // Combined sorted labels (injection dates + exercise dates)
  const allDates = [...new Set([...wRec.map(r => r.gregorianDate), ...exDates])].sort();

  const weights = allDates.map(d => weightByDate[d] ? weightByDate[d].weight : null);
  const minW    = Math.min(...wRec.map(r => r.weight));
  const markerY = Math.floor(minW) - 1.5;
  const markers = allDates.map(d => exDates.has(d) ? markerY : null);

  const ctx = document.getElementById('chartOverview').getContext('2d');
  chartOverviewInst = new Chart(ctx, {
    data: {
      labels: allDates,
      datasets: [
        {
          type: 'line',
          label: 'משקל (ק"ג)',
          data: weights,
          borderColor: '#1a6b8a',
          backgroundColor: 'rgba(26,107,138,0.08)',
          borderWidth: 2.5,
          pointRadius: allDates.map(d => weightByDate[d] ? 5 : 0),
          pointBackgroundColor: '#1a6b8a',
          tension: 0.3,
          fill: true,
          spanGaps: true,
          order: 1,
        },
        {
          type: 'line',
          label: 'יום כושר 🏃',
          data: markers,
          pointStyle: 'triangle',
          pointRadius: allDates.map(d => exDates.has(d) ? 10 : 0),
          pointHoverRadius: allDates.map(d => exDates.has(d) ? 12 : 0),
          backgroundColor: 'rgba(39,174,96,0.85)',
          borderColor: 'transparent',
          borderWidth: 0,
          showLine: false,
          spanGaps: false,
          order: 0,
        }
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true, position: 'top' },
        tooltip: {
          rtl: true,
          callbacks: {
            title: items => {
              const iso = items[0].label;
              const rec = weightByDate[iso];
              return (rec && rec.hebrewDate) ? rec.hebrewDate : autoFillHebrewDate(iso);
            },
            label: item => {
              if (item.datasetIndex === 1) return '🏃 יום כושר';
              return `משקל: ${item.parsed.y} ק"ג`;
            },
          }
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            font: { size: 11 },
            callback: (val, idx) => hebrewDateShort(allDates[idx]),
          }
        },
        y: {
          ticks: { callback: v => v <= markerY ? '🏃' : v + ' ק"ג' },
          min: markerY - 0.5,
          max: Math.ceil(Math.max(...wRec.map(r => r.weight)) + 1),
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
              const r = wRec.find(x => x.gregorianDate === items[0].label);
              return r && r.hebrewDate ? r.hebrewDate : autoFillHebrewDate(items[0].label);
            },
            label: item => `${item.parsed.y} ק"ג${wRec[item.dataIndex].weightWithShoes ? ' (עם נעליים)' : ''}`,
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 11 }, callback: (val, idx) => hebrewDateShort(wRec[idx].gregorianDate) } },
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
    data: { labels: SITES, datasets: [{ data: counts, backgroundColor: SITE_COLORS, borderWidth: 2 }] },
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
  const moving  = weights.map((_, i) => {
    const sl = weights.slice(Math.max(0, i-1), i+2);
    return Math.round(sl.reduce((s,v)=>s+v,0) / sl.length * 10) / 10;
  });
  const ctx = document.getElementById('chartTrend').getContext('2d');
  chartTrendInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: wRec.map(r => r.gregorianDate),
      datasets: [
        { label: 'בפועל',    data: weights, borderColor: 'rgba(26,107,138,0.4)', borderWidth: 1.5, pointRadius: 3, tension: 0.2, fill: false },
        { label: 'ממוצע נע', data: moving,  borderColor: '#e8a020', borderWidth: 2.5, pointRadius: 0, tension: 0.4, fill: false, borderDash: [5,3] }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { rtl: true, position: 'top' },
        tooltip: {
          rtl: true,
          callbacks: {
            title: items => hebrewDateShort(wRec[items[0].dataIndex].gregorianDate),
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 11 }, callback: (val, idx) => hebrewDateShort(wRec[idx].gregorianDate) } },
        y: { ticks: { callback: v => v + ' ק"ג' } }
      }
    }
  });
}

function renderFitnessChart(exercises) {
  chartFitnessInst = destroyChart(chartFitnessInst);
  if (!exercises.length) return;
  const byWeek = {};
  exercises.forEach(e => { const ws = weekStart(e.date); byWeek[ws] = (byWeek[ws]||0)+1; });
  const weeks  = Object.keys(byWeek).sort();
  const ctx = document.getElementById('chartFitnessFreq').getContext('2d');
  chartFitnessInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map(hebrewDateShort),
      datasets: [{ label: 'אימונים בשבוע', data: weeks.map(w=>byWeek[w]), backgroundColor: 'rgba(39,174,96,0.7)', borderColor: '#27ae60', borderWidth: 1.5, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { rtl: true }, tooltip: { rtl: true, callbacks: { label: item => `${item.raw} אימונים` } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function renderCorrelationChart(records, exercises) {
  chartCorrInst = destroyChart(chartCorrInst);
  const canvas = document.getElementById('chartCorrelation');
  const wRec   = sortedByDate(records.filter(r => r.weight));
  if (wRec.length < 3) { canvas.style.display = 'none'; return; }
  const points = [];
  for (let i = 1; i < wRec.length; i++) {
    const loss = wRec[i-1].weight - wRec[i].weight;
    const ws   = weekStart(wRec[i].gregorianDate);
    const exN  = exercises.filter(e => e.date >= ws && e.date <= wRec[i].gregorianDate).length;
    points.push({ x: exN, y: Math.round(loss * 100) / 100, label: wRec[i].hebrewDate });
  }
  canvas.style.display = 'block';
  chartCorrInst = new Chart(canvas.getContext('2d'), {
    type: 'scatter',
    data: { datasets: [{ label: 'שבועות', data: points, backgroundColor: SITE_COLORS[0], pointRadius: 7, pointHoverRadius: 9 }] },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, callbacks: { label: item => { const p = points[item.dataIndex]; return `${p.label}: ${p.x} ימי כושר, ירידה ${p.y} ק"ג`; } } }
      },
      scales: {
        x: { title: { display: true, text: 'ימי כושר בשבוע', font: { size: 12 } }, ticks: { stepSize: 1 }, beginAtZero: true },
        y: { title: { display: true, text: 'ירידת משקל (ק"ג)', font: { size: 12 } } }
      }
    }
  });
}

// ================================================
// Render Tables
// ================================================

function renderInjectionsTable(records) {
  const sorted = sortRecords(records, injSort.field, injSort.dir);
  const tbody  = document.getElementById('injections-tbody');
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>אין רשומות עדיין</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(r => `
    <tr>
      <td>${r.hebrewDate || autoFillHebrewDate(r.gregorianDate)}</td>
      <td class="text-muted" style="font-size:12px">${r.gregorianDate || '—'}</td>
      <td><span class="badge badge-site">${r.site}</span></td>
      <td>${r.dose} מ"ג</td>
      <td>${r.weight ? r.weight + ' ק"ג' : '—'}</td>
      <td class="${r.weightWithShoes ? 'shoes-yes' : 'shoes-no'}">${r.weightWithShoes ? '✓ עם נעליים' : '—'}</td>
      <td class="text-muted">${r.notes || '—'}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${r.id}" data-type="inj">עריכה</button>
        <button class="btn-del"  data-id="${r.id}" data-type="inj">מחק</button>
      </div></td>
    </tr>`).join('');
  updateSortHeaders('injections-table', injSort);
}

function renderExercisesTable(exercises) {
  const sorted = sortRecords(exercises, exSort.field, exSort.dir);
  const tbody  = document.getElementById('exercises-tbody');
  if (!exercises.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>לא נרשמו אימונים עדיין</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${autoFillHebrewDate(e.date)}<br><small class="text-muted">${e.date}</small></td>
      <td><span class="badge badge-fitness">${e.type}</span></td>
      <td>${e.durationMin ? e.durationMin + ' דקות' : '—'}</td>
      <td class="text-muted">${e.notes || '—'}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${e.id}" data-type="ex">עריכה</button>
        <button class="btn-del"  data-id="${e.id}" data-type="ex">מחק</button>
      </div></td>
    </tr>`).join('');
  updateSortHeaders('exercises-table', exSort);
}

function renderPurchasesTable(purchases) {
  const sorted = sortRecords(purchases, purchaseSort.field, purchaseSort.dir);
  const tbody  = document.getElementById('purchases-tbody');
  if (!tbody) return;
  if (!purchases.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>אין רשומות רכישה עדיין</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(p => `
    <tr>
      <td>${p.hebrewDate || autoFillHebrewDate(p.gregorianDate)}<br><small class="text-muted">${p.gregorianDate || ''}</small></td>
      <td>${p.store || '—'}</td>
      <td class="fw-bold">₪${(p.amount || 0).toFixed(2)}</td>
      <td class="text-muted">${p.paymentMethod || '—'}</td>
      <td class="text-muted">${p.notes || '—'}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${p.id}" data-type="pur">עריכה</button>
        <button class="btn-del"  data-id="${p.id}" data-type="pur">מחק</button>
      </div></td>
    </tr>`).join('');
  updateSortHeaders('purchases-table', purchaseSort);
}

function updateSortHeaders(tableId, sortState) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortState.field) th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
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
  const el   = document.getElementById('insights-rate');
  const rate = getWeeklyRate(records);
  if (!rate) { el.innerHTML = '<p class="text-muted">נדרשות לפחות 2 מדידות משקל לחישוב קצב</p>'; return; }
  const cls = rate.rate >= 0.4 && rate.rate <= 1.2 ? 'rate-good' : rate.rate > 1.2 ? 'rate-warn' : 'rate-bad';
  const lbl = rate.rate >= 0.4 && rate.rate <= 1.2 ? '← מצוין!' : rate.rate > 1.2 ? '← מהיר מדי' : '← איטי';
  el.innerHTML = `
    <div class="rate-row"><span class="rate-label">ירידה כוללת</span><span class="rate-value text-success">${rate.totalLoss.toFixed(1)} ק"ג</span></div>
    <div class="rate-row"><span class="rate-label">תקופת מעקב</span><span class="rate-value">${rate.weeks.toFixed(1)} שבועות</span></div>
    <div class="rate-row"><span class="rate-label">קצב שבועי ממוצע</span><span class="rate-value ${cls}">${rate.rate.toFixed(2)} ק"ג/שבוע ${lbl}</span></div>
    <div class="rate-row"><span class="rate-label">קצב חודשי</span><span class="rate-value">${(rate.rate*4.33).toFixed(1)} ק"ג/חודש</span></div>
    <div class="rate-row"><span class="rate-label">משקל פתיחה</span><span class="rate-value">${rate.firstWeight} ק"ג (${autoFillHebrewDate(rate.firstDate)})</span></div>
    <div class="rate-row"><span class="rate-label">משקל נוכחי</span><span class="rate-value">${rate.lastWeight} ק"ג (${autoFillHebrewDate(rate.lastDate)})</span></div>`;
}

function renderBMIGoals(records) {
  const el   = document.getElementById('insights-bmi-goals');
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (!wRec.length) { el.innerHTML = '<p class="text-muted">נדרשת לפחות מדידת משקל אחת</p>'; return; }
  const cur  = wRec[wRec.length-1].weight, start = wRec[0].weight;
  const rate = getWeeklyRate(records);
  el.innerHTML = [
    { bmi: 40, label: 'BMI 40 — שלב 3 לשלב 2' },
    { bmi: 35, label: 'BMI 35 — שלב 2 לשלב 1' },
    { bmi: 30, label: 'BMI 30 — יציאה מהשמנה חמורה' },
    { bmi: 25, label: 'BMI 25 — משקל תקין' },
  ].map(g => {
    const tW = weightForBMI(g.bmi), needed = cur - tW;
    const pct = Math.min(100, Math.round(Math.max(0, (start - cur) / (start - tW)) * 100));
    const ok  = cur <= tW;
    const wl  = rate && rate.rate > 0 ? Math.round(Math.max(0, needed) / rate.rate) : null;
    return `<div class="bmi-goal">
      <div class="bmi-goal-header"><span class="bmi-goal-label">${ok?'✅ ':''}${g.label}</span><span class="bmi-goal-meta">${tW} ק"ג</span></div>
      <div class="progress-bar"><div class="progress-fill ${ok?'done':''}" style="width:${pct}%"></div></div>
      <div class="bmi-goal-sub"><span>${pct}% הושג</span><span>${ok?'הגעת! 🎉':wl!==null?`~${wl} שבועות`:needed>0?`${needed.toFixed(1)} ק"ג נותרו`:'הגעת!'}</span></div>
    </div>`;
  }).join('');
}

function renderCorrelationInsight(records, exercises) {
  const el   = document.getElementById('insights-correlation');
  const wRec = sortedByDate(records.filter(r => r.weight));
  if (wRec.length < 3 || exercises.length < 2) {
    el.innerHTML = `<div class="corr-note warn">נדרשות לפחות 3 מדידות משקל ו-2 אימונים לחישוב הקורלציה. המשך לתעד!</div>`;
    renderCorrelationChart(records, exercises);
    return;
  }
  const withEx = [], withoutEx = [];
  for (let i = 1; i < wRec.length; i++) {
    const loss = wRec[i-1].weight - wRec[i].weight;
    const exN  = exercises.filter(e => e.date >= weekStart(wRec[i].gregorianDate) && e.date <= wRec[i].gregorianDate).length;
    if (exN > 0) withEx.push(loss); else withoutEx.push(loss);
  }
  const avg = arr => arr.length ? (arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(2) : null;
  const aw = avg(withEx), aww = avg(withoutEx);
  const txt = aw && aww
    ? parseFloat(aw) > parseFloat(aww)
      ? `בשבועות עם אימון הירידה הממוצעת הייתה <strong>${aw} ק"ג</strong>, לעומת <strong>${aww} ק"ג</strong> בשבועות ללא כושר — פרש של <strong>${(parseFloat(aw)-parseFloat(aww)).toFixed(2)} ק"ג</strong> לטובת שבועות הכושר!`
      : 'נתונים עדיין מועטים לקביעת קורלציה ברורה. המשך לתעד!'
    : aw ? `ממוצע ירידה בשבועות כושר: <strong>${aw} ק"ג</strong>` : 'הוסף עוד אימונים לקבלת תובנות!';
  el.innerHTML = `<div class="corr-note">${txt}</div>`;
  renderCorrelationChart(records, exercises);
}

function renderDetailedRecs(records) {
  const el   = document.getElementById('insights-recommendations');
  const wRec = sortedByDate(records.filter(r => r.weight));
  const bmi  = wRec.length ? calcBMI(wRec[wRec.length-1].weight) : 43;
  const rate = getWeeklyRate(records);
  const rt   = rate
    ? rate.rate >= 0.4 && rate.rate <= 1.2
      ? `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) מצוין — המשך כך!`
      : rate.rate > 1.2
        ? `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) מהיר מהרצוי — וודא שאתה אוכל מספיק חלבון.`
        : `הקצב שלך (${rate.rate.toFixed(2)} ק"ג/שבוע) איטי מהרצוי — שקול להגביר פעילות גופנית.`
    : 'אין עדיין מספיק נתונים לניתוח קצב.';
  el.innerHTML = `
    <div class="insight-rec-card"><div class="insight-rec-title">📅 תזמון ביחס לזריקה</div>
      <div class="insight-rec-body">הזריקה השבועית ניתנת בערב שבת. מומלץ להימנע מאימון אינטנסיבי ביום הזריקה. הימים המומלצים לאימון: ראשון–חמישי.</div></div>
    <div class="insight-rec-card"><div class="insight-rec-title">🎯 יעד שבועי מומלץ</div>
      <div class="insight-rec-body">${bmi>=40?'3–4 אימונים בשבוע, 20–30 דקות כל אחד. התחל לאט ובנה בהדרגה.':bmi>=35?'4–5 אימונים בשבוע, 30–45 דקות כל אחד. שלב קרדיו עם כוח.':'5 אימונים בשבוע, 45–60 דקות. גיוון בין פעילויות.'}</div></div>
    <div class="insight-rec-card"><div class="insight-rec-title">⚖️ ניתוח קצב ירידת משקל</div>
      <div class="insight-rec-body">${rt}</div></div>
    <div class="insight-rec-card"><div class="insight-rec-title">👟 הערה לגבי מדידת משקל</div>
      <div class="insight-rec-body">למדידה עקבית — מדוד תמיד באותם תנאים (בוקר, לפני ארוחה, ללא נעליים). כשמדדת עם נעליים, סמן זאת בהתאם.</div></div>
    <div class="insight-rec-card"><div class="insight-rec-title">💉 רוטציית מיקומי הזריקה</div>
      <div class="insight-rec-body">הזריקה מסתובבת בין 4 מיקומים (רגל ימין → רגל שמאל → יד ימין → יד שמאל). רוטציה זו חשובה להפחתת גירוי מקומי ושיפור הספיגה.</div></div>`;
}

// ================================================
// Refresh All
// ================================================

function refreshAll() {
  const data = loadData();
  const { records, exercises, purchases } = data;

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

  renderPurchasesDashboard(purchases);
  renderPurchasesTable(purchases);

  renderInsights(records, exercises);
}

// ================================================
// Forms
// ================================================

function openInjectionForm(record) {
  editingInjectionId = record ? record.id : null;
  document.getElementById('injection-form-title').textContent = record ? 'עריכת זריקה' : 'הוספת זריקה';
  document.getElementById('injection-edit-id').value = record ? record.id : '';

  // Hebrew date: primary field
  document.getElementById('inj-hebrew-date').value    = record ? (record.hebrewDate || '') : autoFillHebrewDate(isoToday());
  document.getElementById('inj-gregorian-date').value = record ? (record.gregorianDate || '') : isoToday();
  document.getElementById('inj-site').value           = record ? record.site : getNextSite(loadData().records);
  document.getElementById('inj-dose').value           = record ? record.dose : getLastUsedDose(loadData().records);
  document.getElementById('inj-weight').value         = record ? (record.weight || '') : '';
  document.getElementById('inj-shoes').checked        = record ? !!record.weightWithShoes : false;
  document.getElementById('inj-notes').value          = record ? (record.notes || '') : '';

  const section = document.getElementById('injection-form-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  switchTab('injections');
}

function closeInjectionForm() {
  document.getElementById('injection-form-section').style.display = 'none';
  editingInjectionId = null;
}

function openExerciseForm(ex) {
  editingExerciseId = ex ? ex.id : null;
  document.getElementById('exercise-form-title').textContent = ex ? 'עריכת אימון' : 'הוספת אימון';
  document.getElementById('exercise-edit-id').value  = ex ? ex.id : '';
  document.getElementById('ex-date').value           = ex ? ex.date : isoToday();
  document.getElementById('ex-type').value           = ex ? ex.type : '';
  document.getElementById('ex-duration').value       = ex ? (ex.durationMin || '') : '';
  document.getElementById('ex-notes').value          = ex ? (ex.notes || '') : '';
  const section = document.getElementById('exercise-form-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  switchTab('fitness');
}

function closeExerciseForm() {
  document.getElementById('exercise-form-section').style.display = 'none';
  editingExerciseId = null;
}

function openPurchaseForm(p) {
  editingPurchaseId = p ? p.id : null;
  const titleEl = document.getElementById('purchase-form-title');
  if (titleEl) titleEl.textContent = p ? 'עריכת רכישה' : 'הוספת רכישה';

  document.getElementById('pur-edit-id').value      = p ? p.id : '';
  document.getElementById('pur-hebrew-date').value  = p ? (p.hebrewDate || '') : autoFillHebrewDate(isoToday());
  document.getElementById('pur-gregorian-date').value = p ? (p.gregorianDate || '') : isoToday();
  document.getElementById('pur-store').value         = p ? (p.store || '') : '';
  document.getElementById('pur-amount').value        = p ? (p.amount || '') : '';
  document.getElementById('pur-payment').value       = p ? (p.paymentMethod || '') : '';
  document.getElementById('pur-notes').value         = p ? (p.notes || '') : '';

  const section = document.getElementById('purchase-form-section');
  if (section) {
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  switchTab('purchases');
}

function closePurchaseForm() {
  const section = document.getElementById('purchase-form-section');
  if (section) section.style.display = 'none';
  editingPurchaseId = null;
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
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.id === 'tab-' + tabId));
}

// ================================================
// Export
// ================================================

function exportJSON() {
  const data = loadData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `natuni-health-${isoToday()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ================================================
// Event Listeners
// ================================================

document.addEventListener('DOMContentLoaded', () => {

  Chart.defaults.font.family = "'Segoe UI', 'Arial Hebrew', Arial, sans-serif";
  Chart.defaults.plugins.legend.rtl  = true;
  Chart.defaults.plugins.tooltip.rtl = true;

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

  const btnAddPur = document.getElementById('btn-add-purchase');
  if (btnAddPur) btnAddPur.addEventListener('click', () => openPurchaseForm(null));
  const btnAddPur2 = document.getElementById('btn-add-purchase-2');
  if (btnAddPur2) btnAddPur2.addEventListener('click', () => openPurchaseForm(null));

  // ---- Injection form ----
  document.getElementById('btn-close-injection-form').addEventListener('click', closeInjectionForm);
  document.getElementById('btn-cancel-injection').addEventListener('click', closeInjectionForm);

  // Hebrew date (primary) → auto-fill Gregorian
  document.getElementById('inj-hebrew-date').addEventListener('change', (e) => {
    const iso = hebrewToGregorianISO(e.target.value);
    if (iso) document.getElementById('inj-gregorian-date').value = iso;
  });

  // Gregorian (secondary) → auto-fill Hebrew (always overwrite for consistency)
  document.getElementById('inj-gregorian-date').addEventListener('change', (e) => {
    document.getElementById('inj-hebrew-date').value = autoFillHebrewDate(e.target.value);
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
    if (!record.gregorianDate || !record.site) { alert('נא למלא תאריך ומיקום זריקה'); return; }
    if (editingInjectionId) updateRecord(editingInjectionId, record); else addRecord(record);
    closeInjectionForm();
    refreshAll();
  });

  // ---- Exercise form ----
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
    if (!ex.date || !ex.type) { alert('נא למלא תאריך וסוג פעילות'); return; }
    if (editingExerciseId) updateExercise(editingExerciseId, ex); else addExercise(ex);
    closeExerciseForm();
    refreshAll();
  });

  // ---- Purchase form ----
  const purForm = document.getElementById('purchase-form');
  if (purForm) {
    document.getElementById('btn-close-purchase-form').addEventListener('click', closePurchaseForm);
    document.getElementById('btn-cancel-purchase').addEventListener('click', closePurchaseForm);

    document.getElementById('pur-hebrew-date').addEventListener('change', (e) => {
      const iso = hebrewToGregorianISO(e.target.value);
      if (iso) document.getElementById('pur-gregorian-date').value = iso;
    });

    document.getElementById('pur-gregorian-date').addEventListener('change', (e) => {
      document.getElementById('pur-hebrew-date').value = autoFillHebrewDate(e.target.value);
    });

    purForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = {
        hebrewDate:    document.getElementById('pur-hebrew-date').value.trim(),
        gregorianDate: document.getElementById('pur-gregorian-date').value,
        store:         document.getElementById('pur-store').value.trim(),
        amount:        parseFloat(document.getElementById('pur-amount').value) || 0,
        paymentMethod: document.getElementById('pur-payment').value.trim(),
        notes:         document.getElementById('pur-notes').value.trim(),
      };
      if (!p.gregorianDate) { alert('נא למלא תאריך'); return; }
      if (editingPurchaseId) updatePurchase(editingPurchaseId, p); else addPurchase(p);
      closePurchaseForm();
      refreshAll();
    });
  }

  // ---- Table actions (event delegation) ----
  document.getElementById('injections-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id  = btn.dataset.id;
    if (btn.classList.contains('btn-edit')) { const r = loadData().records.find(x => x.id === id); if (r) openInjectionForm(r); }
    else if (btn.classList.contains('btn-del')) showConfirm('האם למחוק רשומת זריקה זו?', () => { deleteRecord(id); refreshAll(); });
  });

  document.getElementById('exercises-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id  = btn.dataset.id;
    if (btn.classList.contains('btn-edit')) { const x = loadData().exercises.find(e => e.id === id); if (x) openExerciseForm(x); }
    else if (btn.classList.contains('btn-del')) showConfirm('האם למחוק רשומת אימון זו?', () => { deleteExercise(id); refreshAll(); });
  });

  const purTbody = document.getElementById('purchases-tbody');
  if (purTbody) {
    purTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      const id  = btn.dataset.id;
      if (btn.classList.contains('btn-edit')) { const p = loadData().purchases.find(x => x.id === id); if (p) openPurchaseForm(p); }
      else if (btn.classList.contains('btn-del')) showConfirm('האם למחוק רשומת רכישה זו?', () => { deletePurchase(id); refreshAll(); });
    });
  }

  // ---- Sort headers ----
  document.getElementById('injections-table').querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      injSort.dir = injSort.field === th.dataset.sort ? (injSort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      injSort.field = th.dataset.sort;
      renderInjectionsTable(loadData().records);
    });
  });

  document.getElementById('exercises-table').querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      exSort.dir = exSort.field === th.dataset.sort ? (exSort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      exSort.field = th.dataset.sort;
      renderExercisesTable(loadData().exercises);
    });
  });

  const purTable = document.getElementById('purchases-table');
  if (purTable) {
    purTable.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        purchaseSort.dir = purchaseSort.field === th.dataset.sort ? (purchaseSort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
        purchaseSort.field = th.dataset.sort;
        renderPurchasesTable(loadData().purchases);
      });
    });
  }

  // ---- Modal ----
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-confirm').addEventListener('click', () => { if (pendingDeleteFn) pendingDeleteFn(); hideModal(); });
  document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target === document.getElementById('modal-overlay')) hideModal(); });
});
