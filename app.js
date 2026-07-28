(() => {
  'use strict';

  const CONFIG = window.MONEYBOARD_CONFIG || {};
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const won = value => `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
  const shortWon = value => {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 10000) {
      const man = n / 10000;
      return `${Number.isInteger(man) ? man : man.toFixed(1)}만원`;
    }
    return won(n);
  };
  const todayString = () => new Date().toISOString().slice(0, 10);
  const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const safeText = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const CATEGORIES = {
    grocery: { name: '장보기', icon: '🛒', group: 'common' },
    delivery: { name: '배달', icon: '🛵', group: 'common' },
    dining: { name: '외식', icon: '🍽️', group: 'common' },
    fuel: { name: '주유', icon: '⛽', group: 'common' },
    household: { name: '생활용품', icon: '📦', group: 'common' },
    utility: { name: '공과금', icon: '💡', group: 'common' },
    husband: { name: '남편 개인', icon: '👨', group: 'husband' },
    wife: { name: '아내 개인', icon: '👩', group: 'wife' },
    irregular: { name: '비정기', icon: '🎁', group: 'irregular' },
    other: { name: '기타', icon: '➕', group: 'common' }
  };

  const GROUP_LABELS = {
    common: '공동생활비',
    husband: '남편 개인비용',
    wife: '아내 개인비용',
    irregular: '비정기 공동비용'
  };

  const state = {
    page: 'home',
    commitmentTab: 'installments',
    loading: true,
    mode: CONFIG.demoMode ? 'demo' : 'firebase',
    user: null,
    settings: null,
    expenses: [],
    installments: [],
    recurring: [],
    plans: [],
    unsubs: []
  };

  const defaultData = () => ({
    settings: {
      monthlyTarget: 2500000,
      cycleStartDay: 1,
      husbandName: '남편',
      wifeName: '아내',
      cardName: '공동 카드',
      updatedAt: Date.now()
    },
    expenses: [],
    installments: [
      {
        id: 'initial_installment',
        name: '기존 할부 합계 · 세부내역 확인 필요',
        totalAmount: 0,
        monthlyAmount: 1200000,
        remainingMonths: 1,
        endDate: '',
        memo: '카드 앱에서 할부별 월 납부액과 종료일을 확인한 뒤 개별 항목으로 나누세요.',
        active: true,
        createdAt: Date.now()
      }
    ],
    recurring: [
      {
        id: 'initial_electricity',
        name: '전기세 예상',
        monthlyAmount: 120000,
        dueDay: 20,
        memo: '월 10~15만원 예상값 중 중간값으로 설정',
        active: true,
        createdAt: Date.now()
      }
    ],
    plans: []
  });

  class LocalRepository {
    constructor() {
      this.key = 'moneyboard_demo_v1';
      if (!localStorage.getItem(this.key)) this.write(defaultData());
    }
    read() {
      try { return JSON.parse(localStorage.getItem(this.key)) || defaultData(); }
      catch { return defaultData(); }
    }
    write(data) { localStorage.setItem(this.key, JSON.stringify(data)); }
    async subscribe(onData) { onData(this.read()); return () => {}; }
    async save(type, item) {
      const data = this.read();
      if (type === 'settings') data.settings = { ...data.settings, ...item, updatedAt: Date.now() };
      else {
        const list = data[type] || [];
        const index = list.findIndex(row => row.id === item.id);
        const row = { ...item, id: item.id || uid(), updatedAt: Date.now() };
        if (index >= 0) list[index] = row; else list.push(row);
        data[type] = list;
      }
      this.write(data);
      return data;
    }
    async remove(type, id) {
      const data = this.read();
      data[type] = (data[type] || []).filter(item => item.id !== id);
      this.write(data);
      return data;
    }
    async replaceAll(payload) {
      this.write(payload);
      return payload;
    }
  }

  class FirebaseRepository {
    constructor() {
      if (!window.firebase) throw new Error('Firebase SDK를 불러오지 못했습니다.');
      const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
      const missing = required.filter(key => !CONFIG.firebase?.[key]);
      if (missing.length) throw new Error(`config.js의 Firebase 설정이 비어 있습니다: ${missing.join(', ')}`);
      if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      this.base = this.db.collection('households').doc(CONFIG.householdId || 'our-home');
      this.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    }
    onAuth(callback) { return this.auth.onAuthStateChanged(callback); }
    async login(email, password) { return this.auth.signInWithEmailAndPassword(email, password); }
    async logout() { return this.auth.signOut(); }
    allowed(email) {
      const allowed = (CONFIG.allowedEmails || []).map(v => String(v).toLowerCase());
      return allowed.includes(String(email || '').toLowerCase());
    }
    async ensureSeed() {
      const settingsRef = this.base.collection('settings').doc('main');
      const snap = await settingsRef.get();
      if (snap.exists) return;
      const seed = defaultData();
      const batch = this.db.batch();
      batch.set(settingsRef, seed.settings);
      seed.installments.forEach(item => batch.set(this.base.collection('installments').doc(item.id), item));
      seed.recurring.forEach(item => batch.set(this.base.collection('recurring').doc(item.id), item));
      await batch.commit();
    }
    subscribe(onData) {
      const cache = { settings: null, expenses: [], installments: [], recurring: [], plans: [] };
      const emit = () => onData(structuredClone(cache));
      const unsubs = [];
      unsubs.push(this.base.collection('settings').doc('main').onSnapshot(snap => { cache.settings = snap.data() || defaultData().settings; emit(); }));
      ['expenses', 'installments', 'recurring', 'plans'].forEach(type => {
        unsubs.push(this.base.collection(type).onSnapshot(snap => {
          cache[type] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          emit();
        }));
      });
      return () => unsubs.forEach(unsub => unsub());
    }
    async save(type, item) {
      if (type === 'settings') {
        await this.base.collection('settings').doc('main').set({ ...item, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return;
      }
      const id = item.id || uid();
      const payload = { ...item, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      delete payload.id;
      await this.base.collection(type).doc(id).set(payload, { merge: true });
    }
    async remove(type, id) { await this.base.collection(type).doc(id).delete(); }
    async replaceAll(payload) {
      const batch = this.db.batch();
      batch.set(this.base.collection('settings').doc('main'), payload.settings || defaultData().settings);
      for (const type of ['expenses', 'installments', 'recurring', 'plans']) {
        const old = await this.base.collection(type).get();
        old.docs.forEach(doc => batch.delete(doc.ref));
        (payload[type] || []).forEach(item => {
          const id = item.id || uid();
          const copy = { ...item }; delete copy.id;
          batch.set(this.base.collection(type).doc(id), copy);
        });
      }
      await batch.commit();
    }
  }

  let repo;

  function setSync(status, text) {
    const badge = $('#syncBadge');
    if (!badge) return;
    badge.classList.remove('syncing', 'error');
    if (status !== 'ok') badge.classList.add(status);
    $('#syncText').textContent = text;
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('#toastRoot').appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  function getCycleRange(referenceDate = new Date()) {
    const startDay = Math.min(28, Math.max(1, Number(state.settings?.cycleStartDay || 1)));
    const now = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    let start;
    if (now.getDate() >= startDay) start = new Date(now.getFullYear(), now.getMonth(), startDay);
    else start = new Date(now.getFullYear(), now.getMonth() - 1, startDay);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, startDay - 1);
    const toStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { start: toStr(start), end: toStr(end), startDate: start, endDate: end };
  }

  function cycleExpenses() {
    const range = getCycleRange();
    return state.expenses.filter(item => item.date >= range.start && item.date <= range.end);
  }

  function activeInstallments() { return state.installments.filter(item => item.active !== false && Number(item.remainingMonths ?? 1) > 0); }
  function activeRecurring() { return state.recurring.filter(item => item.active !== false); }

  function totals() {
    const expenses = cycleExpenses();
    const variable = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const installments = activeInstallments().reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0);
    const recurring = activeRecurring().reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0);
    const forecast = variable + installments + recurring;
    const target = Number(state.settings?.monthlyTarget || 0);
    const remaining = target - forecast;
    const breakdown = expenses.reduce((acc, item) => {
      const category = CATEGORIES[item.category] || CATEGORIES.other;
      const group = item.group || category.group;
      acc[group] = (acc[group] || 0) + Number(item.amount || 0);
      return acc;
    }, { common: 0, husband: 0, wife: 0, irregular: 0 });
    return { expenses, variable, installments, recurring, forecast, target, remaining, breakdown };
  }

  function groupTag(group) {
    if (group === 'common') return '<span class="tag common">공동</span>';
    if (group === 'irregular') return '<span class="tag irregular">비정기</span>';
    return '<span class="tag personal">개인</span>';
  }

  function categoryInfo(key) { return CATEGORIES[key] || CATEGORIES.other; }

  function renderHome() {
    const t = totals();
    const range = getCycleRange();
    const ratio = t.target > 0 ? Math.min(120, Math.max(0, (t.forecast / t.target) * 100)) : 0;
    const progressClass = ratio >= 100 ? 'danger' : ratio >= 85 ? 'warning' : '';
    const status = t.remaining >= 0
      ? { title: `${shortWon(t.remaining)} 더 사용할 수 있어요`, sub: '목표 카드값 안에서 남은 금액입니다.' }
      : { title: `${shortWon(Math.abs(t.remaining))} 초과 예상`, sub: '추가 지출 전 내역을 함께 확인해보세요.' };
    const recent = [...t.expenses].sort((a,b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 5);
    const maxBreak = Math.max(1, ...Object.values(t.breakdown));

    return `
      <section class="hero-card">
        <div class="hero-top">
          <div><p class="eyebrow">다음 카드값 예상</p><h2>${shortWon(t.forecast)} <small>/ ${shortWon(t.target)}</small></h2></div>
          <span class="cycle-chip">${range.start.slice(5).replace('-', '.')} ~ ${range.end.slice(5).replace('-', '.')}</span>
        </div>
        <div class="progress-track"><div class="progress-bar ${progressClass}" style="width:${Math.min(100, ratio)}%"></div></div>
        <div class="progress-meta"><span>사용률 ${Math.round(ratio)}%</span><span>목표 ${won(t.target)}</span></div>
        <div class="hero-status"><div><strong>${status.title}</strong><br><span>${status.sub}</span></div><span>${t.remaining >= 0 ? '안정' : '확인 필요'}</span></div>
      </section>

      <section class="metric-grid">
        <article class="metric-card card"><div class="metric-label">기존 할부</div><div class="metric-value">${shortWon(t.installments)}</div><div class="metric-sub">${activeInstallments().length}개 항목</div></article>
        <article class="metric-card card"><div class="metric-label">고정·자동결제</div><div class="metric-value">${shortWon(t.recurring)}</div><div class="metric-sub">${activeRecurring().length}개 항목</div></article>
        <article class="metric-card card"><div class="metric-label">이번 주기 새 지출</div><div class="metric-value">${shortWon(t.variable)}</div><div class="metric-sub">${t.expenses.length}건 입력</div></article>
        <article class="metric-card card"><div class="metric-label">남은 사용 가능액</div><div class="metric-value" style="color:${t.remaining < 0 ? 'var(--red)' : 'var(--green)'}">${shortWon(t.remaining)}</div><div class="metric-sub">할부·고정비 포함</div></article>
      </section>

      <div class="section-head"><div><h2>빠른 지출 등록</h2><p>결제 직후 5초 안에 입력하세요.</p></div></div>
      <section class="quick-grid">
        ${['grocery','delivery','dining','fuel','household','utility','wife','other'].map(key => {
          const c = CATEGORIES[key]; return `<button class="quick-btn" data-quick="${key}"><span>${c.icon}</span><b>${c.name}</b></button>`;
        }).join('')}
      </section>

      <div class="section-head"><div><h2>새 지출 구성</h2><p>현재 결제주기에 직접 입력한 사용액입니다.</p></div></div>
      <section class="card card-pad breakdown">
        ${Object.entries(t.breakdown).map(([group, amount]) => `
          <div class="break-row"><label>${GROUP_LABELS[group]}</label><div class="mini-track"><div class="mini-bar" style="width:${(amount/maxBreak)*100}%"></div></div><b>${shortWon(amount)}</b></div>
        `).join('')}
      </section>

      <div class="section-head"><div><h2>최근 지출</h2><p>수정하려면 항목을 누르세요.</p></div><button class="text-btn" data-go="expenses">전체보기</button></div>
      <section class="list">
        ${recent.length ? recent.map(expenseItemHtml).join('') : `<div class="empty"><span class="emoji">🧾</span>아직 등록된 새 지출이 없습니다.</div>`}
      </section>
    `;
  }

  function expenseItemHtml(item) {
    const c = categoryInfo(item.category);
    const group = item.group || c.group;
    return `<article class="list-item clickable" data-edit-expense="${safeText(item.id)}">
      <div class="item-icon">${c.icon}</div>
      <div class="item-body"><div class="item-title"><strong>${safeText(item.memo || c.name)}</strong><b>${won(item.amount)}</b></div>
      <div class="item-meta"><span>${safeText(item.date)}</span><span>${safeText(item.payer || '')}</span>${groupTag(group)}</div></div>
    </article>`;
  }

  function renderExpenses() {
    const range = getCycleRange();
    const rows = [...cycleExpenses()].sort((a,b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`));
    const total = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    return `
      <div class="section-head"><div><h2>지출 내역</h2><p>${range.start} ~ ${range.end}</p></div></div>
      <section class="summary-strip">
        <div class="summary-box"><span>건수</span><b>${rows.length}건</b></div>
        <div class="summary-box"><span>새 지출</span><b>${shortWon(total)}</b></div>
        <div class="summary-box"><span>일 평균</span><b>${shortWon(rows.length ? total / Math.max(1, new Date().getDate()) : 0)}</b></div>
      </section>
      <div class="toolbar">
        <input id="expenseSearch" class="search-input" type="search" placeholder="내용 검색" />
        <select id="expenseFilter" class="filter-select">
          <option value="all">전체 구분</option><option value="common">공동</option><option value="husband">남편</option><option value="wife">아내</option><option value="irregular">비정기</option>
        </select>
      </div>
      <section id="expenseList" class="list">${rows.length ? rows.map(expenseItemHtml).join('') : `<div class="empty"><span class="emoji">🧾</span>등록된 지출이 없습니다.</div>`}</section>
      <button class="fab" type="button" data-add="expense" aria-label="지출 추가">＋</button>
    `;
  }

  function installmentItemHtml(item) {
    const remain = Number(item.remainingMonths || 0);
    return `<article class="list-item clickable" data-edit-installment="${safeText(item.id)}">
      <div class="item-icon">🧾</div><div class="item-body"><div class="item-title"><strong>${safeText(item.name)}</strong><b>${won(item.monthlyAmount)}</b></div>
      <div class="item-meta"><span>${remain ? `${remain}개월 남음` : '종료 확인'}</span>${item.endDate ? `<span>${safeText(item.endDate)} 종료</span>` : ''}${item.active === false ? '<span class="tag over">중지</span>' : ''}</div></div>
    </article>`;
  }

  function recurringItemHtml(item) {
    return `<article class="list-item clickable" data-edit-recurring="${safeText(item.id)}">
      <div class="item-icon">🔁</div><div class="item-body"><div class="item-title"><strong>${safeText(item.name)}</strong><b>${won(item.monthlyAmount)}</b></div>
      <div class="item-meta"><span>매월 ${Number(item.dueDay || 1)}일 예상</span>${item.active === false ? '<span class="tag over">중지</span>' : ''}</div></div>
    </article>`;
  }

  function renderCommitments() {
    const isI = state.commitmentTab === 'installments';
    const rows = isI ? [...state.installments].sort((a,b) => Number(b.monthlyAmount)-Number(a.monthlyAmount)) : [...state.recurring].sort((a,b) => Number(a.dueDay)-Number(b.dueDay));
    const total = rows.filter(x => x.active !== false).reduce((s,x) => s + Number(x.monthlyAmount || 0),0);
    return `
      <div class="section-head"><div><h2>고정 부담 관리</h2><p>과거 할부와 매달 반복되는 비용을 나눠 봅니다.</p></div></div>
      <div class="segmented"><button data-commitment-tab="installments" class="${isI?'active':''}">할부</button><button data-commitment-tab="recurring" class="${!isI?'active':''}">고정·자동결제</button></div>
      <section class="card card-pad" style="margin-bottom:13px"><div class="metric-label">현재 월 합계</div><div class="metric-value">${won(total)}</div><div class="metric-sub">대시보드 예상 카드값에 자동 포함됩니다.</div></section>
      <section class="list">
        ${rows.length ? rows.map(isI ? installmentItemHtml : recurringItemHtml).join('') : `<div class="empty"><span class="emoji">${isI?'🧾':'🔁'}</span>등록된 항목이 없습니다.</div>`}
      </section>
      <button class="fab" type="button" data-add="${isI?'installment':'recurring'}" aria-label="항목 추가">＋</button>
    `;
  }

  function planItemHtml(item) {
    const statusLabel = item.status === 'paid' ? '집행완료' : item.status === 'cancelled' ? '취소' : '예정';
    return `<article class="list-item clickable" data-edit-plan="${safeText(item.id)}">
      <div class="item-icon">${item.status === 'paid' ? '✅' : '📅'}</div><div class="item-body"><div class="item-title"><strong>${safeText(item.name)}</strong><b>${won(item.amount)}</b></div>
      <div class="item-meta"><span>${safeText(item.date || '날짜 미정')}</span><span>${safeText(item.funding || '처리방법 미정')}</span><span class="tag ${item.status==='paid'?'common':'irregular'}">${statusLabel}</span></div></div>
    </article>`;
  }

  function renderPlans() {
    const rows = [...state.plans].sort((a,b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
    const planned = rows.filter(x => x.status !== 'paid' && x.status !== 'cancelled').reduce((s,x) => s + Number(x.amount || 0),0);
    return `
      <div class="section-head"><div><h2>큰 지출 계획</h2><p>가족행사·여행·가전처럼 미리 합의할 비용입니다.</p></div></div>
      <section class="card card-pad" style="margin-bottom:13px"><div class="metric-label">앞으로 예정된 금액</div><div class="metric-value">${won(planned)}</div><div class="metric-sub">현재 카드값 예상에는 포함되지 않습니다.</div></section>
      <section class="list">${rows.length ? rows.map(planItemHtml).join('') : `<div class="empty"><span class="emoji">📅</span>예정된 큰 지출이 없습니다.</div>`}</section>
      <button class="fab" type="button" data-add="plan" aria-label="계획 추가">＋</button>
    `;
  }

  function renderSettings() {
    const s = state.settings || defaultData().settings;
    return `
      <div class="section-head"><div><h2>설정</h2><p>두 사람이 합의한 기준값을 관리합니다.</p></div></div>
      <form id="settingsForm" class="card settings-group">
        <h3>카드생활비 기준</h3>
        <label><span>목표 카드값</span><input name="monthlyTarget" type="number" min="0" step="10000" value="${Number(s.monthlyTarget || 0)}" /></label>
        <label><span>결제주기 시작일</span><input name="cycleStartDay" type="number" min="1" max="28" value="${Number(s.cycleStartDay || 1)}" /></label>
        <p class="helper">카드 앱의 이용기간 시작일을 1~28 사이 숫자로 입력합니다. 정확한 이용기간은 카드사 앱에서 확인하세요.</p>
        <div class="divider"></div>
        <h3>표시 이름</h3>
        <div class="inline-fields"><label><span>남편</span><input name="husbandName" value="${safeText(s.husbandName || '남편')}" /></label><label><span>아내</span><input name="wifeName" value="${safeText(s.wifeName || '아내')}" /></label></div>
        <label><span>공동 카드 별칭</span><input name="cardName" value="${safeText(s.cardName || '공동 카드')}" /></label>
        <button class="primary-btn full" type="submit">설정 저장</button>
      </form>

      <div class="section-head"><div><h2>데이터 관리</h2><p>정기적으로 개인 파일로 보관하세요.</p></div></div>
      <section class="card settings-group">
        <button id="exportJson" class="secondary-btn full" type="button">전체 데이터 JSON 백업</button>
        <button id="exportCsv" class="secondary-btn full" type="button">지출 내역 CSV 저장</button>
        <label><span>백업 데이터 불러오기</span><input id="importJson" type="file" accept="application/json" /></label>
        ${state.mode === 'demo' ? '<button id="resetDemo" class="danger-btn full" type="button">데모 데이터 초기화</button>' : '<button id="logoutBtn" class="danger-btn full" type="button">로그아웃</button>'}
        <p class="helper">카드번호·CVC·계좌 비밀번호 등 민감정보는 기록하지 마세요.</p>
      </section>

      <section class="card card-pad" style="margin-top:14px">
        <div class="metric-label">현재 저장 방식</div><div class="metric-value">${state.mode === 'demo' ? '이 기기 데모 저장' : 'Firebase 실시간 공유'}</div>
        <div class="metric-sub">${state.mode === 'demo' ? 'config.js에서 Firebase 연결 전까지 두 기기 간 공유되지 않습니다.' : safeText(state.user?.email || '')}</div>
      </section>
    `;
  }

  function render() {
    if (!state.settings) return;
    const page = state.page;
    const html = page === 'home' ? renderHome() : page === 'expenses' ? renderExpenses() : page === 'commitments' ? renderCommitments() : page === 'plans' ? renderPlans() : renderSettings();
    $('#pageContainer').innerHTML = html;
    $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
    bindPageEvents();
  }

  function bindPageEvents() {
    $$('[data-quick]').forEach(btn => btn.addEventListener('click', () => openExpenseModal(null, btn.dataset.quick)));
    $$('[data-go]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.go)));
    $$('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      const type = btn.dataset.add;
      if (type === 'expense') openExpenseModal();
      else if (type === 'installment') openInstallmentModal();
      else if (type === 'recurring') openRecurringModal();
      else if (type === 'plan') openPlanModal();
    }));
    $$('[data-edit-expense]').forEach(el => el.addEventListener('click', () => openExpenseModal(state.expenses.find(x => x.id === el.dataset.editExpense))));
    $$('[data-edit-installment]').forEach(el => el.addEventListener('click', () => openInstallmentModal(state.installments.find(x => x.id === el.dataset.editInstallment))));
    $$('[data-edit-recurring]').forEach(el => el.addEventListener('click', () => openRecurringModal(state.recurring.find(x => x.id === el.dataset.editRecurring))));
    $$('[data-edit-plan]').forEach(el => el.addEventListener('click', () => openPlanModal(state.plans.find(x => x.id === el.dataset.editPlan))));
    $$('[data-commitment-tab]').forEach(btn => btn.addEventListener('click', () => { state.commitmentTab = btn.dataset.commitmentTab; render(); }));

    const search = $('#expenseSearch');
    const filter = $('#expenseFilter');
    if (search && filter) {
      const apply = () => {
        const keyword = search.value.trim().toLowerCase();
        const group = filter.value;
        const rows = cycleExpenses().filter(item => {
          const c = categoryInfo(item.category);
          const itemGroup = item.group || c.group;
          const text = `${item.memo || ''} ${c.name} ${item.payer || ''}`.toLowerCase();
          return (!keyword || text.includes(keyword)) && (group === 'all' || itemGroup === group);
        }).sort((a,b) => String(b.date).localeCompare(String(a.date)));
        $('#expenseList').innerHTML = rows.length ? rows.map(expenseItemHtml).join('') : `<div class="empty"><span class="emoji">🔎</span>조건에 맞는 지출이 없습니다.</div>`;
        $$('[data-edit-expense]').forEach(el => el.addEventListener('click', () => openExpenseModal(state.expenses.find(x => x.id === el.dataset.editExpense))));
      };
      search.addEventListener('input', apply); filter.addEventListener('change', apply);
    }

    const settingsForm = $('#settingsForm');
    if (settingsForm) settingsForm.addEventListener('submit', saveSettings);
    $('#exportJson')?.addEventListener('click', exportJson);
    $('#exportCsv')?.addEventListener('click', exportCsv);
    $('#importJson')?.addEventListener('change', importJson);
    $('#resetDemo')?.addEventListener('click', resetDemo);
    $('#logoutBtn')?.addEventListener('click', () => repo.logout());
  }

  function navigate(page) {
    state.page = page;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(title, bodyHtml) {
    $('#modalRoot').innerHTML = `<div class="modal-backdrop"><section class="modal-sheet"><div class="sheet-handle"></div><div class="modal-head"><h2>${title}</h2><button class="close-btn" type="button" aria-label="닫기">×</button></div>${bodyHtml}</section></div>`;
    $('.close-btn').addEventListener('click', closeModal);
    $('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }

  function openExpenseModal(item = null, presetCategory = 'grocery') {
    const current = item || { date: todayString(), category: presetCategory, group: CATEGORIES[presetCategory]?.group || 'common', payer: state.settings?.wifeName || '아내', paymentMethod: state.settings?.cardName || '공동 카드', amount: '', memo: '' };
    const selected = current.category || presetCategory;
    openModal(item ? '지출 수정' : '지출 등록', `
      <form id="expenseForm" class="form-grid">
        <input type="hidden" name="id" value="${safeText(current.id || '')}" />
        <label><span>금액</span><div class="amount-wrap"><input class="amount-input" name="amount" inputmode="numeric" type="number" min="0" step="100" required value="${current.amount || ''}" placeholder="0" /></div></label>
        <div><label style="margin-bottom:8px"><span>카테고리</span></label><div class="category-picker">
          ${Object.entries(CATEGORIES).map(([key,c]) => `<button type="button" class="category-option ${key===selected?'active':''}" data-category="${key}"><span>${c.icon}</span><b>${c.name}</b></button>`).join('')}
        </div></div>
        <input type="hidden" name="category" value="${safeText(selected)}" />
        <label><span>비용 구분</span><select name="group">
          ${Object.entries(GROUP_LABELS).map(([key,label]) => `<option value="${key}" ${(current.group || CATEGORIES[selected].group)===key?'selected':''}>${label}</option>`).join('')}
        </select></label>
        <div class="inline-fields"><label><span>결제자</span><select name="payer"><option ${current.payer===state.settings.husbandName?'selected':''}>${safeText(state.settings.husbandName)}</option><option ${current.payer===state.settings.wifeName?'selected':''}>${safeText(state.settings.wifeName)}</option></select></label><label><span>날짜</span><input name="date" type="date" value="${safeText(current.date || todayString())}" required /></label></div>
        <label><span>결제수단</span><input name="paymentMethod" value="${safeText(current.paymentMethod || state.settings.cardName)}" /></label>
        <label><span>메모</span><input name="memo" value="${safeText(current.memo || '')}" placeholder="예: 쿠팡 생필품, 친구들과 저녁" /></label>
        <div class="form-actions ${item?'':'single'}">${item?'<button id="deleteExpense" class="danger-btn" type="button">삭제</button>':''}<button class="primary-btn" type="submit">저장</button></div>
      </form>
    `);
    $$('.category-option').forEach(btn => btn.addEventListener('click', () => {
      $$('.category-option').forEach(x => x.classList.remove('active')); btn.classList.add('active');
      $('#expenseForm [name="category"]').value = btn.dataset.category;
      $('#expenseForm [name="group"]').value = CATEGORIES[btn.dataset.category].group;
    }));
    $('#expenseForm').addEventListener('submit', saveExpense);
    $('#deleteExpense')?.addEventListener('click', () => removeItem('expenses', item.id, '지출을 삭제했습니다.'));
    setTimeout(() => $('#expenseForm [name="amount"]').focus(), 80);
  }

  async function saveExpense(e) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const item = { id: fd.get('id') || undefined, amount: Number(fd.get('amount')), category: fd.get('category'), group: fd.get('group'), payer: fd.get('payer'), date: fd.get('date'), paymentMethod: fd.get('paymentMethod'), memo: fd.get('memo'), createdAt: Date.now() };
    await saveItem('expenses', item, '지출을 저장했습니다.');
  }

  function openInstallmentModal(item = null) {
    const x = item || { name:'', totalAmount:'', monthlyAmount:'', remainingMonths:'', endDate:'', memo:'', active:true };
    openModal(item ? '할부 수정' : '할부 등록', `<form id="installmentForm" class="form-grid">
      <input type="hidden" name="id" value="${safeText(x.id || '')}" />
      <label><span>항목명</span><input name="name" required value="${safeText(x.name || '')}" placeholder="예: 신혼여행 숙박" /></label>
      <div class="inline-fields"><label><span>총 결제금액</span><input name="totalAmount" type="number" min="0" step="1000" value="${Number(x.totalAmount || 0) || ''}" /></label><label><span>월 청구액</span><input name="monthlyAmount" type="number" min="0" step="1000" required value="${Number(x.monthlyAmount || 0) || ''}" /></label></div>
      <div class="inline-fields"><label><span>남은 개월</span><input name="remainingMonths" type="number" min="0" max="120" value="${Number(x.remainingMonths || 0)}" /></label><label><span>종료 예정일</span><input name="endDate" type="date" value="${safeText(x.endDate || '')}" /></label></div>
      <label><span>상태</span><select name="active"><option value="true" ${x.active!==false?'selected':''}>사용 중</option><option value="false" ${x.active===false?'selected':''}>종료·중지</option></select></label>
      <label><span>메모</span><textarea name="memo">${safeText(x.memo || '')}</textarea></label>
      <div class="form-actions ${item?'':'single'}">${item?'<button id="deleteInstallment" class="danger-btn" type="button">삭제</button>':''}<button class="primary-btn" type="submit">저장</button></div>
    </form>`);
    $('#installmentForm').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.currentTarget); await saveItem('installments',{ id:fd.get('id')||undefined,name:fd.get('name'),totalAmount:Number(fd.get('totalAmount')),monthlyAmount:Number(fd.get('monthlyAmount')),remainingMonths:Number(fd.get('remainingMonths')),endDate:fd.get('endDate'),memo:fd.get('memo'),active:fd.get('active')==='true',createdAt:Date.now() },'할부를 저장했습니다.'); });
    $('#deleteInstallment')?.addEventListener('click', () => removeItem('installments', item.id, '할부를 삭제했습니다.'));
  }

  function openRecurringModal(item = null) {
    const x = item || { name:'', monthlyAmount:'', dueDay:1, memo:'', active:true };
    openModal(item ? '고정비 수정' : '고정비 등록', `<form id="recurringForm" class="form-grid">
      <input type="hidden" name="id" value="${safeText(x.id || '')}" />
      <label><span>항목명</span><input name="name" required value="${safeText(x.name || '')}" placeholder="예: 전기세 예상" /></label>
      <div class="inline-fields"><label><span>월 예상금액</span><input name="monthlyAmount" type="number" min="0" step="1000" required value="${Number(x.monthlyAmount || 0) || ''}" /></label><label><span>예상 결제일</span><input name="dueDay" type="number" min="1" max="31" value="${Number(x.dueDay || 1)}" /></label></div>
      <label><span>상태</span><select name="active"><option value="true" ${x.active!==false?'selected':''}>사용 중</option><option value="false" ${x.active===false?'selected':''}>중지</option></select></label>
      <label><span>메모</span><textarea name="memo">${safeText(x.memo || '')}</textarea></label>
      <div class="form-actions ${item?'':'single'}">${item?'<button id="deleteRecurring" class="danger-btn" type="button">삭제</button>':''}<button class="primary-btn" type="submit">저장</button></div>
    </form>`);
    $('#recurringForm').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.currentTarget); await saveItem('recurring',{ id:fd.get('id')||undefined,name:fd.get('name'),monthlyAmount:Number(fd.get('monthlyAmount')),dueDay:Number(fd.get('dueDay')),memo:fd.get('memo'),active:fd.get('active')==='true',createdAt:Date.now() },'고정비를 저장했습니다.'); });
    $('#deleteRecurring')?.addEventListener('click', () => removeItem('recurring', item.id, '고정비를 삭제했습니다.'));
  }

  function openPlanModal(item = null) {
    const x = item || { name:'', amount:'', date:'', funding:'', status:'planned', memo:'' };
    openModal(item ? '지출 계획 수정' : '큰 지출 계획', `<form id="planForm" class="form-grid">
      <input type="hidden" name="id" value="${safeText(x.id || '')}" />
      <label><span>항목명</span><input name="name" required value="${safeText(x.name || '')}" placeholder="예: 가족행사, 오키나와 공금" /></label>
      <div class="inline-fields"><label><span>예상금액</span><input name="amount" type="number" min="0" step="1000" required value="${Number(x.amount || 0) || ''}" /></label><label><span>예정일</span><input name="date" type="date" value="${safeText(x.date || '')}" /></label></div>
      <label><span>처리 방법</span><input name="funding" value="${safeText(x.funding || '')}" placeholder="예: 공금 40 + 각자 20" /></label>
      <label><span>상태</span><select name="status"><option value="planned" ${x.status==='planned'?'selected':''}>예정</option><option value="paid" ${x.status==='paid'?'selected':''}>집행완료</option><option value="cancelled" ${x.status==='cancelled'?'selected':''}>취소</option></select></label>
      <label><span>메모</span><textarea name="memo">${safeText(x.memo || '')}</textarea></label>
      <div class="form-actions ${item?'':'single'}">${item?'<button id="deletePlan" class="danger-btn" type="button">삭제</button>':''}<button class="primary-btn" type="submit">저장</button></div>
    </form>`);
    $('#planForm').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.currentTarget); await saveItem('plans',{ id:fd.get('id')||undefined,name:fd.get('name'),amount:Number(fd.get('amount')),date:fd.get('date'),funding:fd.get('funding'),status:fd.get('status'),memo:fd.get('memo'),createdAt:Date.now() },'계획을 저장했습니다.'); });
    $('#deletePlan')?.addEventListener('click', () => removeItem('plans', item.id, '계획을 삭제했습니다.'));
  }

  async function saveItem(type, item, message) {
    try {
      setSync('syncing','저장 중');
      const data = await repo.save(type, item);
      if (state.mode === 'demo' && data) applyData(data);
      closeModal(); toast(message); setSync('ok','저장됨');
    } catch (error) { console.error(error); setSync('error','저장 실패'); toast(`저장 실패: ${error.message}`); }
  }

  async function removeItem(type, id, message) {
    if (!confirm('정말 삭제할까요?')) return;
    try {
      setSync('syncing','삭제 중');
      const data = await repo.remove(type, id);
      if (state.mode === 'demo' && data) applyData(data);
      closeModal(); toast(message); setSync('ok','저장됨');
    } catch (error) { console.error(error); toast(`삭제 실패: ${error.message}`); }
  }

  async function saveSettings(e) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    await saveItem('settings',{ monthlyTarget:Number(fd.get('monthlyTarget')),cycleStartDay:Number(fd.get('cycleStartDay')),husbandName:fd.get('husbandName'),wifeName:fd.get('wifeName'),cardName:fd.get('cardName') },'설정을 저장했습니다.');
  }

  function exportJson() {
    downloadFile(`moneyboard-backup-${todayString()}.json`, JSON.stringify({ settings:state.settings,expenses:state.expenses,installments:state.installments,recurring:state.recurring,plans:state.plans }, null, 2), 'application/json');
  }

  function exportCsv() {
    const header = ['날짜','금액','카테고리','구분','결제자','결제수단','메모'];
    const rows = state.expenses.map(x => [x.date,x.amount,categoryInfo(x.category).name,GROUP_LABELS[x.group || categoryInfo(x.category).group],x.payer,x.paymentMethod,x.memo]);
    const csv = '\ufeff' + [header,...rows].map(row => row.map(v => `"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
    downloadFile(`moneyboard-expenses-${todayString()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function downloadFile(name, content, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content],{type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000);
  }

  async function importJson(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!confirm('현재 데이터를 백업 파일 내용으로 교체할까요?')) { e.target.value=''; return; }
    try {
      const payload = JSON.parse(await file.text());
      if (!payload.settings || !Array.isArray(payload.expenses)) throw new Error('머니보드 백업 파일 형식이 아닙니다.');
      setSync('syncing','불러오는 중');
      const data = await repo.replaceAll(payload);
      if (state.mode === 'demo' && data) applyData(data);
      toast('백업 데이터를 불러왔습니다.'); setSync('ok','저장됨');
    } catch (error) { toast(`불러오기 실패: ${error.message}`); setSync('error','오류'); }
    e.target.value='';
  }

  async function resetDemo() {
    if (!confirm('데모 데이터를 처음 상태로 되돌릴까요?')) return;
    const data = defaultData(); await repo.replaceAll(data); applyData(data); toast('초기화했습니다.');
  }

  function applyData(data) {
    if (!data) return;
    state.settings = data.settings || state.settings || defaultData().settings;
    state.expenses = data.expenses || [];
    state.installments = data.installments || [];
    state.recurring = data.recurring || [];
    state.plans = data.plans || [];
    state.loading = false;
    render();
  }

  async function startData() {
    state.unsubs.forEach(fn => fn()); state.unsubs = [];
    if (state.mode === 'firebase') await repo.ensureSeed();
    const unsub = await repo.subscribe(data => { applyData(data); setSync('ok', state.mode === 'demo' ? '이 기기 저장' : '실시간 동기화'); });
    state.unsubs.push(unsub);
    $('#loadingScreen').classList.add('hidden');
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#appTitle').textContent = CONFIG.appName || '머니보드';
  }

  async function init() {
    try {
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
      $$('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));

      if (CONFIG.demoMode) {
        repo = new LocalRepository();
        state.mode = 'demo';
        state.user = { email: 'demo@local' };
        await startData();
        return;
      }

      repo = new FirebaseRepository();
      state.mode = 'firebase';
      repo.onAuth(async user => {
        $('#loadingScreen').classList.add('hidden');
        if (!user) {
          state.user = null;
          $('#app').classList.add('hidden');
          $('#loginScreen').classList.remove('hidden');
          return;
        }
        if (!repo.allowed(user.email)) {
          await repo.logout();
          $('#loginMessage').textContent = '이 앱에 등록되지 않은 이메일입니다.';
          return;
        }
        state.user = user;
        await startData();
      });
      $('#loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const message = $('#loginMessage'); message.textContent = '로그인 중...';
        try { await repo.login($('#loginEmail').value.trim(), $('#loginPassword').value); message.textContent = ''; }
        catch (error) { console.error(error); message.textContent = '이메일 또는 비밀번호를 확인해 주세요.'; }
      });
    } catch (error) {
      console.error(error);
      $('#loadingScreen').innerHTML = `<div class="auth-card"><div class="brand-mark small">!</div><h1>설정을 확인해 주세요</h1><p class="muted">${safeText(error.message)}</p><p class="helper">config.js의 demoMode를 true로 되돌리면 우선 화면을 확인할 수 있습니다.</p></div>`;
    }
  }

  init();
})();
