/* ==========================================================================
   NEON REQUIEM — engine.js
   선택형 로그라이크 엔진: 상태 · 판정 · 효과 · 전투 · 상점 · 메타 진행 · 렌더링
   데이터 파일(js/data/*.js)은 이 파일 다음에 로드되어 NR.def / NR.scenes 로 등록된다.
   ========================================================================== */
(function () {
  'use strict';

  const NR = (window.NR = window.NR || {});
  const D = (NR.D = {
    scenes: {}, items: {}, ware: {}, enemies: {}, stances: {}, origins: {}, comps: {},
    endings: {}, lore: {}, frags: {}, upgrades: {}, acts: {}, flagNames: {}, ambient: {},
    names: [], epilogue: null, deathLines: null,
  });

  NR.scenes = (list) => list.forEach((o) => {
    if (D.scenes[o.id]) console.warn('[NR] duplicate scene id:', o.id);
    D.scenes[o.id] = o;
  });
  NR.def = (kind, map) => { Object.assign(D[kind], map); };

  /* ---------------------------------------------------------------- utils */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const val = (x, s) => (typeof x === 'function' ? x(s) : x);
  const sgn = (n) => (n > 0 ? '+' + n : '−' + Math.abs(n));
  const pad = (n) => String(n).padStart(4, '0');
  function wpick(list, wf) {
    let tot = 0;
    const ws = list.map((x) => { const w = Math.max(0, wf(x) || 0); tot += w; return w; });
    if (tot <= 0) return null;
    let r = Math.random() * tot;
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r < 0) return list[i]; }
    return list[list.length - 1];
  }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ESC[c]);

  /* 조사 처리: 플레이어 이름 뒤에 붙는 은/는, 이/가 등을 받침에 맞게 고른다 */
  function lastHangul(word) {
    const c = word.charCodeAt(word.length - 1);
    return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : -1;
  }
  const JOSA = { 은: ['은', '는'], 는: ['은', '는'], 이: ['이', '가'], 가: ['이', '가'], 을: ['을', '를'], 를: ['을', '를'], 과: ['과', '와'], 와: ['과', '와'], 아: ['아', '야'], 야: ['아', '야'], 이여: ['이여', '여'] };
  function josa(word, j) {
    if (!word) return '';
    const b = lastHangul(word);
    if (j === '으로' || j === '로') return word + (b > 0 && b !== 8 ? '으로' : '로');
    const p = JOSA[j];
    if (!p) return word + j;
    return word + (b > 0 ? p[0] : p[1]);
  }

  const STAT = { body: '무력', reflex: '반사', net: '해킹', cool: '화술' };
  const STAT_EN = { body: 'BODY', reflex: 'REFLEX', net: 'NET', cool: 'COOL' };
  const BUFF = { stim: '다음 판정 +25%', ice: '다음 해킹 판정 +40%' };
  const ALLY_FLAGS = ['docks_ally', 'saints_ally', 'wraiths_ally', 'protest_ally'];

  /* --------------------------------------------------------- persistence */
  const META_KEY = 'neon-requiem.meta.v1';
  const RUN_KEY = 'neon-requiem.run.v1';
  const store = {
    get(k) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장소 사용 불가: 무시 */ } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function freshMeta() {
    return {
      runs: 0, deaths: 0, echoes: 0, totalEchoes: 0, bestAct: 0,
      upgrades: {}, frags: {}, lore: {}, endings: {}, unlocked: {},
      settings: { sound: true, motion: !reducedMotion() },
    };
  }
  function loadMeta() {
    const m = freshMeta();
    const s = store.get(META_KEY);
    if (s && typeof s === 'object') {
      Object.assign(m, s);
      ['upgrades', 'frags', 'lore', 'endings', 'unlocked'].forEach((k) => { if (!m[k] || typeof m[k] !== 'object') m[k] = {}; });
      m.settings = Object.assign(freshMeta().settings, s.settings || {});
    }
    return m;
  }
  let meta = loadMeta();
  const saveMeta = () => store.set(META_KEY, meta);
  let run = null;
  const saveRun = () => { if (run && run.mode !== 'end') store.set(RUN_KEY, run); };

  const ui = { view: 'title', origin: null, tab: 'frags', drawer: false, confirm: null, lastKey: '', lastLog: 0, lastFight: 0, lastView: '' };

  /* -------------------------------------------------------- helpers (data) */
  NR.has = (s, id) => s.items.includes(id);
  NR.allies = (s) => ALLY_FLAGS.filter((f) => s.flags[f]).length;
  NR.allFrags = () => Object.keys(D.frags).every((k) => meta.frags[k]);
  NR.fragCount = () => Object.keys(D.frags).filter((k) => meta.frags[k]).length;
  NR.runs = () => meta.runs;
  NR.deaths = () => meta.deaths;
  NR.util = { clamp, ri, pick, arr, val, josa, esc };
  /* 휴식 대화 고르기: 아직 안 본 대화 중 조건을 만족하는 것(우선순위 높은 것 먼저) */
  NR.talk = (tag, fallback) => (s) => {
    const list = Object.values(D.scenes).filter((x) => x.kind === 'talk' && x.tag === tag && !s.seen[x.id] && (!x.cond || x.cond(s)));
    if (!list.length) return fallback;
    const top = Math.max(...list.map((x) => x.pri || 0));
    return pick(list.filter((x) => (x.pri || 0) === top)).id;
  };

  /* ----------------------------------------------------------- run state */
  function newRun(name, originId) {
    const O = D.origins[originId], up = meta.upgrades;
    meta.runs += 1; saveMeta();
    const r = {
      v: 1, runNo: meta.runs, name: name, origin: originId,
      maxhp: O.hp + (up.body ? 3 : 0), hp: 0, hum: O.hum, cred: O.cred + (up.stash ? 50 : 0),
      heat: 2, bond: 2 + (up.warmth ? 1 : 0),
      stats: Object.assign({}, O.stats), items: O.items.slice(), ware: [], comps: [], dead: [],
      flags: {}, vars: {}, buffs: {}, second: !!up.second,
      act: 0, step: 0, steps: 0, enterNo: 0, seen: {}, kills: 0, newFrags: [], newLore: [],
      mode: 'act', scene: null, sceneHTML: '', sceneTitle: '', sceneLoc: '', enter: [], log: [], used: [],
      phase: 'choose', pending: null, cards: [], fight: null, shop: null, lastType: null, ambient: '',
      ending: null, unlockMsg: null,
    };
    r.hp = r.maxhp;
    if (up.kit) r.items.push('medkit');
    return r;
  }

  function statVal(k) {
    let v = run.stats[k] || 0;
    run.ware.forEach((w) => { const W = D.ware[w]; if (W && W.stat && W.stat[k]) v += W.stat[k]; });
    return v;
  }
  const gearIds = () => [...new Set(run.items)].filter((id) => D.items[id] && D.items[id].gear);
  const wareSum = (key) => run.ware.reduce((a, w) => a + ((D.ware[w] && D.ware[w][key]) || 0), 0);
  const hasWare = (id) => run.ware.includes(id);
  function armor() {
    let a = wareSum('armor');
    gearIds().forEach((id) => { a += D.items[id].armor || 0; });
    run.comps.forEach((c) => { a += (D.comps[c] && D.comps[c].armor) || 0; });
    return Math.min(3, a);
  }
  function priceMul() {
    const O = D.origins[run.origin];
    return ((O.perk && O.perk.shop) || 1) * (1 + Math.max(0, run.act - 1) * 0.1);
  }
  const price = (base) => Math.max(1, Math.round(base * priceMul()));

  function calcChance(stat, mod, fight) {
    let c = 20 + 15 * statVal(stat) + (mod || 0);
    run.comps.forEach((id) => { const C = D.comps[id]; if (C && C.bonus && C.bonus[stat]) c += C.bonus[stat]; });
    gearIds().forEach((id) => { const I = D.items[id]; if (I.bonus && I.bonus[stat]) c += I.bonus[stat]; });
    if (meta.upgrades.intuition) c += 5;
    const P = D.origins[run.origin].perk || {};
    if (P.stat && P.stat[stat]) c += P.stat[stat];
    if (fight && P.fight) c += P.fight;
    if (P.act && P.act[run.act]) c += P.act[run.act];
    if (run.buffs.stim) c += 25;
    if (stat === 'net' && run.buffs.ice) c += 40;
    if (run.hp <= Math.ceil(run.maxhp * 0.2)) c -= 10;
    return clamp(Math.round(c), 5, 95);
  }
  function doRoll(stat, mod, fight) {
    const chance = calcChance(stat, mod, fight);
    const roll = ri(1, 100);
    if (run.buffs.stim) delete run.buffs.stim;
    if (stat === 'net' && run.buffs.ice) delete run.buffs.ice;
    return { stat, chance, roll, ok: roll <= chance };
  }

  function reqCheck(r) {
    const L = [];
    if (!r) return { ok: true, labels: L };
    const push = (t, ok) => L.push({ t, ok: !!ok });
    if (r.cred != null) push('₡' + r.cred, run.cred >= r.cred);
    arr(r.item).forEach((id) => push(D.items[id].name, run.items.includes(id)));
    arr(r.ware).forEach((id) => push(D.ware[id].name, run.ware.includes(id)));
    if (r.stat) Object.keys(r.stat).forEach((k) => push(STAT[k] + ' ' + r.stat[k] + '+', statVal(k) >= r.stat[k]));
    arr(r.comp).forEach((c) => push(D.comps[c].name + ' 동행', run.comps.includes(c)));
    if (r.origin) push(D.origins[r.origin].name, run.origin === r.origin);
    if (r.bond != null) push('유대 ' + r.bond + '+', run.bond >= r.bond);
    if (r.hum != null) push('인간성 ' + r.hum + '+', run.hum >= r.hum);
    if (r.humMax != null) push('인간성 ' + r.humMax + ' 이하', run.hum <= r.humMax);
    if (r.allies != null) push('동맹 세력 ' + r.allies + '+', NR.allies(run) >= r.allies);
    arr(r.flag).forEach((f) => push(D.flagNames[f] || '', !!run.flags[f]));
    arr(r.noflag).forEach((f) => push('', !run.flags[f]));
    return { ok: L.every((x) => x.ok), labels: L };
  }

  /* ------------------------------------------------------------- effects */
  function applyFx(fxIn) {
    const fx = val(fxIn, run);
    const d = [];
    if (!fx) return d;
    const add = (t, cls) => d.push({ t, cls });
    if (fx.maxhp) {
      run.maxhp = Math.max(1, run.maxhp + fx.maxhp);
      if (fx.maxhp > 0) run.hp += fx.maxhp;
      run.hp = Math.min(run.hp, run.maxhp);
      add('최대 체력 ' + sgn(fx.maxhp), fx.maxhp > 0 ? 'good' : 'bad');
    }
    if (fx.hp) {
      const b = run.hp; run.hp = Math.min(run.maxhp, run.hp + fx.hp);
      const dd = run.hp - b; if (dd) add('체력 ' + sgn(dd), dd > 0 ? 'good' : 'bad');
    }
    if (fx.hum) { const b = run.hum; run.hum = clamp(run.hum + fx.hum, 0, 10); const dd = run.hum - b; if (dd) add('인간성 ' + sgn(dd), 'soul'); }
    if (fx.cred) { const b = run.cred; run.cred = Math.max(0, run.cred + fx.cred); const dd = run.cred - b; if (dd) add('₡ ' + sgn(dd), 'cred'); }
    if (fx.heat) { const b = run.heat; run.heat = clamp(run.heat + fx.heat, 0, 10); const dd = run.heat - b; if (dd) add('열기 ' + sgn(dd), 'heat'); }
    if (fx.bond) { const b = run.bond; run.bond = clamp(run.bond + fx.bond, 0, 10); const dd = run.bond - b; if (dd) add('유대 ' + sgn(dd), 'mia'); }
    if (fx.stat) Object.keys(fx.stat).forEach((k) => { run.stats[k] = clamp(run.stats[k] + fx.stat[k], 0, 6); add(STAT[k] + ' ' + sgn(fx.stat[k]), 'good'); });
    arr(fx.item).forEach((id) => { run.items.push(id); add('획득 · ' + D.items[id].name, 'item'); });
    arr(fx.drop).forEach((id) => { const k = run.items.indexOf(id); if (k >= 0) { run.items.splice(k, 1); add('잃음 · ' + D.items[id].name, 'bad'); } });
    arr(fx.ware).forEach((id) => installWare(id, d));
    arr(fx.flag).forEach((f) => { run.flags[f] = 1; });
    arr(fx.unflag).forEach((f) => { delete run.flags[f]; });
    if (fx.v) Object.keys(fx.v).forEach((k) => { run.vars[k] = (run.vars[k] || 0) + fx.v[k]; });
    arr(fx.comp).forEach((c) => {
      if (!run.comps.includes(c) && !run.dead.includes(c)) { run.comps.push(c); add('동료 합류 · ' + D.comps[c].name, 'comp'); }
    });
    arr(fx.leave).forEach((c) => { const k = run.comps.indexOf(c); if (k >= 0) { run.comps.splice(k, 1); add('동료 이탈 · ' + D.comps[c].name, 'bad'); } });
    arr(fx.kill).forEach((c) => {
      const k = run.comps.indexOf(c); if (k >= 0) run.comps.splice(k, 1);
      if (!run.dead.includes(c)) run.dead.push(c);
      run.flags['dead_' + c] = 1; add(D.comps[c].name + ' 사망', 'bad');
    });
    arr(fx.buff).forEach((b) => { run.buffs[b] = 1; add(BUFF[b], 'good'); });
    arr(fx.lore).forEach((id) => {
      if (!D.lore[id]) return;
      if (!meta.lore[id]) { meta.lore[id] = 1; run.newLore.push(id); saveMeta(); add('데이터 파일 · ' + D.lore[id].title, 'lore'); }
    });
    arr(fx.frag).forEach((id) => {
      if (!D.frags[id]) return;
      const isNew = !meta.frags[id];
      if (isNew) { meta.frags[id] = 1; run.newFrags.push(id); saveMeta(); }
      d.push({ frag: id, isNew });
    });
    return d;
  }
  function installWare(id, d) {
    const W = D.ware[id];
    if (!W || run.ware.includes(id)) return;
    run.ware.push(id);
    d.push({ t: '시술 · ' + W.name, cls: 'item' });
    if (W.maxhp) { run.maxhp += W.maxhp; run.hp += W.maxhp; d.push({ t: '최대 체력 +' + W.maxhp, cls: 'good' }); }
  }
  /* 사망/광증 검사. 두 번째 심장 · 아드레날린 펌프가 있으면 한 번 버틴다. */
  function checkDeath(d) {
    if (run.hp <= 0) {
      if (run.second) { run.second = false; run.hp = 1; if (d) d.push({ t: '두 번째 심장 — 체력 1로 버텼다', cls: 'mia' }); toast('두 번째 심장이 뛴다.'); }
      else if (hasWare('pump') && !run.flags._pump) { run.flags._pump = 1; run.hp = 5; if (d) d.push({ t: '아드레날린 펌프 작동 — 체력 5', cls: 'mia' }); toast('아드레날린 펌프 작동!'); }
      else return 'flatline';
    }
    if (run.hum <= 0) return 'psycho';
    return null;
  }

  /* -------------------------------------------------------- acts & map */
  const TYPES = {
    event: { label: '사건', en: 'EVENT', w: 42, hint: '무슨 일이 기다리고 있다.' },
    fight: { label: '교전', en: 'HOSTILE', w: 17, hint: '적대 신호 감지.' },
    market: { label: '암시장', en: 'MARKET', w: 9, hint: '물건을 사고판다.' },
    clinic: { label: '시술소', en: 'CLINIC', w: 7, hint: '치료와 크롬 시술.' },
    rest: { label: '은신처', en: 'SAFEHOUSE', w: 10, hint: '숨을 고르고 상처를 돌본다.' },
    mystery: { label: '미확인', en: 'UNKNOWN', w: 15, hint: '정체를 알 수 없는 신호.' },
    story: { label: '스토리', en: 'STORY', hint: '이야기가 움직인다.' },
    boss: { label: '결전', en: 'CRISIS', hint: '피할 수 없는 고비.' },
  };

  function beginAct(n) {
    run.act = n; run.step = 0; run.mode = 'act';
    if (n >= 2) run.heat = Math.max(0, run.heat - 3);
    saveRun(); render();
  }
  function forcedAt(act, step) {
    const A = D.acts[act];
    let f = A.script[step];
    if (typeof f === 'function') f = f(run);
    return f || null;
  }
  function prepareStep(auto) {
    const forced = forcedAt(run.act, run.step);
    if (forced && auto) { enterScene(forced); return; }
    run.cards = genCards(); run.mode = 'map';
    saveRun(); render();
  }
  function inAct(sc, act) {
    const a = sc.acts;
    return a === 'any' || (Array.isArray(a) ? a.includes(act) : a === act);
  }
  function drawPool(kind, mystery, used) {
    const list = Object.values(D.scenes).filter((sc) => sc.kind === kind && inAct(sc, run.act) && !used.has(sc.id) &&
      !(run.seen[sc.id] && sc.once !== false) && (!sc.cond || sc.cond(run)) && (mystery || !sc.mysteryOnly));
    const p = wpick(list, (sc) => (sc.w || 10) * (mystery && sc.mysteryOnly ? 2.5 : 1));
    return p ? p.id : null;
  }
  function pickAmbient() {
    const list = (D.ambient[run.act] || []).filter((a) => !a.if || a.if(run));
    return list.length ? val(pick(list).t, run) : '';
  }
  function genCards() {
    const A = D.acts[run.act];
    run.ambient = pickAmbient();
    const forced = forcedAt(run.act, run.step);
    if (forced) {
      const sc = D.scenes[forced];
      return [{ type: sc.boss ? 'boss' : 'story', id: forced, loc: val(sc.loc, run), title: val(sc.title, run) }];
    }
    const cards = [], used = new Set(), cnt = {};
    const keys = Object.keys(TYPES).filter((k) => TYPES[k].w);
    for (let tries = 0; cards.length < 3 && tries < 80; tries++) {
      const t = wpick(keys, (k) => {
        let w = TYPES[k].w;
        if (k !== 'event' && cnt[k]) return 0;
        if (k === 'rest' && run.hp < run.maxhp * 0.5) w *= 2;
        if (k === 'clinic' && run.hp < run.maxhp * 0.4) w *= 1.6;
        if (k === run.lastType && k !== 'event') w *= 0.35;
        return w;
      });
      let id = null;
      if (t === 'event' || t === 'mystery') id = drawPool('event', t === 'mystery', used);
      else if (t === 'fight') id = drawPool('fight', false, used);
      else id = A[t];
      if (!id || used.has(id) || !D.scenes[id]) continue;
      used.add(id); cnt[t] = (cnt[t] || 0) + 1;
      const sc = D.scenes[id];
      cards.push({ type: t, id, loc: t === 'mystery' ? '알 수 없는 신호' : val(sc.loc, run), title: t === 'mystery' ? '???' : val(sc.title, run) });
    }
    if (!cards.length) cards.push({ type: 'rest', id: A.rest, loc: val(D.scenes[A.rest].loc, run), title: val(D.scenes[A.rest].title, run) });
    return cards;
  }
  function ambushChance() {
    let c = Math.max(0, (run.heat - 3) * 7);
    if (meta.upgrades.stealth) c *= 0.7;
    return Math.round(c);
  }
  function chooseCard(i) {
    const c = run.cards[i];
    if (!c) return;
    sfx('click');
    run.lastType = c.type;
    if (c.type !== 'story' && c.type !== 'boss' && D.acts[run.act].ambush && Math.random() * 100 < ambushChance()) {
      toast('매복! 추적자들이 길목을 막았다.');
      enterScene(D.acts[run.act].ambush);
      return;
    }
    enterScene(c.id);
  }
  function finishStep() {
    run.scene = null; run.pending = null; run.fight = null; run.shop = null; run.log = []; run.used = [];
    run.step += 1; run.steps += 1;
    const rg = wareSum('regen');
    if (rg && run.hp > 0 && run.hp < run.maxhp) run.hp = Math.min(run.maxhp, run.hp + rg);
    const A = D.acts[run.act];
    if (run.step >= A.script.length) {
      const next = run.act + 1;
      if (D.acts[next]) {
        if (next > meta.bestAct) meta.bestAct = next;
        run.unlockMsg = null;
        if (next >= 2 && !meta.unlocked.corp) { meta.unlocked.corp = 1; run.unlockMsg = '새 출신 해금 — 기업 탈주자'; }
        saveMeta(); beginAct(next); return;
      }
    }
    prepareStep(false);
  }

  /* -------------------------------------------------------------- scenes */
  function enterScene(id) {
    const sc = D.scenes[id];
    if (!sc) { console.error('[NR] missing scene', id); finishStep(); return; }
    run.mode = 'scene'; run.scene = id; run.seen[id] = 1; run.enterNo += 1;
    run.log = []; run.used = []; run.phase = 'choose'; run.pending = null;
    run.sceneTitle = val(sc.title, run) || ''; run.sceneLoc = val(sc.loc, run) || '';
    run.sceneHTML = fmt(val(sc.text, run));
    run.enter = sc.onEnter ? applyFx(sc.onEnter) : [];
    const dd = checkDeath(run.enter);
    if (dd) { run.phase = 'result'; run.pending = { death: dd }; }
    saveRun(); render();
  }
  function listChoices() {
    const sc = D.scenes[run.scene];
    const out = [];
    (sc.choices || []).forEach((ch, i) => {
      if (run.used.includes(i)) return;
      if (ch.if && !ch.if(run)) return;
      const rq = reqCheck(ch.req);
      const chance = ch.check ? calcChance(ch.check[0], val(ch.check[1], run) || 0, false) : null;
      out.push({ i, label: fmtInline(val(ch.t, run)), req: rq, chance, stat: ch.check ? ch.check[0] : null });
    });
    return out;
  }
  function outcomeOf(p) {
    const ch = D.scenes[p.scene].choices[p.i];
    return p.branch ? (ch[p.branch] || {}) : ch;
  }
  function choose(i) {
    if (run.phase !== 'choose') return;
    const sc = D.scenes[run.scene];
    const ch = sc.choices[i];
    if (!ch || run.used.includes(i) || (ch.if && !ch.if(run)) || !reqCheck(ch.req).ok) return;
    let out = ch, branch = null, rr = null;
    if (ch.check) {
      rr = doRoll(ch.check[0], val(ch.check[1], run) || 0, false);
      branch = rr.ok ? 'ok' : 'no';
      out = ch[branch] || {};
    }
    const entry = { label: fmtInline(val(ch.t, run)), roll: rr, html: '', deltas: [] };
    entry.deltas = applyFx(out.fx);
    entry.html = out.r ? fmt(val(out.r, run)) : '';
    run.log.push(entry);
    sfx(rr ? (rr.ok ? 'ok' : 'fail') : 'click');
    const dd = checkDeath(entry.deltas);
    if (dd) { run.phase = 'result'; run.pending = { death: dd }; saveRun(); render(); return; }
    const hasNext = out.go || out.fight || out.end || out.shop;
    if (ch.stay && !hasNext) { run.used.push(i); run.phase = 'choose'; }
    else { run.phase = 'result'; run.pending = { scene: run.scene, i, branch }; }
    saveRun(); render();
  }
  function proceed() {
    const p = run.pending;
    if (!p) { finishStep(); return; }
    if (p.death) { endRun(p.death); return; }
    const out = outcomeOf(p);
    if (out.end) { endRun(val(out.end, run)); return; }
    if (out.fight) { startFight(p); return; }
    if (out.shop) { openShop(out.shop); return; }
    if (out.go) { const g = val(out.go, run); if (g) { enterScene(g); return; } }
    finishStep();
  }

  /* --------------------------------------------------------------- fight */
  const GENERIC = {
    body: ['당신의 주먹이 상대의 방어를 뚫고 꽂힌다.', '팔꿈치로 턱을 올려친다. 무언가 부러지는 소리.', '거리를 좁혀 관절을 꺾는다.'],
    reflex: ['세 발. 전부 명중.', '엄폐물 사이로 정확히 쏘아 넣는다.', '반 박자 빠르게 방아쇠를 당긴다.'],
    net: ['상대의 임플란트에 역류 코드를 쏘아 넣는다. 경련.', '조준 보조 장치를 해킹해 아군을 쏘게 만든다.', '신경 링크를 과부하시킨다. 비명.'],
    miss: ['빗나갔다.', '상대가 한 수 빨랐다.', '발이 미끄러진다.', '방화벽에 튕겨 나온다.'],
  };
  function stanceList(E) { return E.stances || (E.mech ? ['scan', 'charge', 'shield', 'overheat'] : ['cover', 'rush', 'reload', 'aim', 'flank', 'waver']); }
  function fightSpec() {
    const F = run.fight;
    const out = outcomeOf(F.src);
    const f = val(out.fight, run);
    return typeof f === 'string' ? { e: f } : f;
  }
  function startFight(src) {
    const out = outcomeOf(src);
    let spec = val(out.fight, run);
    if (typeof spec === 'string') spec = { e: spec };
    const E = D.enemies[spec.e];
    const hp = E.hp + (spec.hpMod || 0);
    run.mode = 'fight';
    run.fight = { e: spec.e, hp, max: hp, round: 1, stance: pick(stanceList(E)), log: [], src, done: null, spUsed: [] };
    run.fight.log.push(fmt(val(spec.intro || E.intro, run) || ''));
    sfx('glitch'); saveRun(); render();
  }
  function modFor(k) {
    const F = run.fight, E = D.enemies[F.e], st = D.stances[F.stance] || { mods: {} };
    const sm = st.mods || {};
    if (k === 'flee') return -10 + (E.fleeMod || 0) + (sm.flee || 0);
    return ((E.mods && E.mods[k]) || 0) + (sm[k] || 0);
  }
  function fightMoves() {
    const F = run.fight, E = D.enemies[F.e];
    const moves = [];
    const base = [['body', '근접 제압'], ['reflex', '사격'], ['net', '해킹']];
    base.forEach(([k, label]) => {
      if (E.immune && E.immune.includes(k)) return;
      moves.push({ id: k, stat: k, label: (E.labels && E.labels[k]) || label, chance: calcChance(k, modFor(k), true) });
    });
    if (E.talk) moves.push({ id: 'cool', stat: 'cool', label: (E.labels && E.labels.cool) || '위협 · 설득', chance: calcChance('cool', modFor('cool'), true) });
    if (!E.noflee) moves.push({ id: 'flee', stat: 'reflex', label: '도주', chance: calcChance('reflex', modFor('flee'), true) });
    (E.special || []).forEach((sp, j) => {
      if (F.spUsed.includes(j)) return;
      if (sp.if && !sp.if(run)) return;
      moves.push({ id: 'sp' + j, special: j, stat: sp.check ? sp.check[0] : null, label: val(sp.t, run), req: reqCheck(sp.req),
        chance: sp.check ? calcChance(sp.check[0], (sp.check[1] || 0) + modFor(sp.check[0]), true) : null });
    });
    return moves;
  }
  function enemyHit(L) {
    const E = D.enemies[run.fight.e];
    const dmg = Math.max(1, ri(E.atk[0], E.atk[1]) - armor());
    run.hp -= dmg;
    L.push(`<p class="dmg">${esc(E.short || E.name)}의 반격 — 체력 −${dmg}</p>`);
    sfx('hit');
  }
  function fightAct(id) {
    const F = run.fight;
    if (!F || F.done) return;
    const E = D.enemies[F.e];
    const mv = fightMoves().find((m) => m.id === id);
    if (!mv || (mv.req && !mv.req.ok)) return;
    const L = [];
    let hit = false;
    if (mv.special != null) {
      const sp = E.special[mv.special];
      F.spUsed.push(mv.special);
      let out = sp, rr = null, branch = null;
      if (sp.check) { rr = doRoll(sp.check[0], (sp.check[1] || 0) + modFor(sp.check[0]), true); branch = rr.ok ? 'ok' : 'no'; out = sp[branch] || {}; }
      L.push(rollLine(mv.label, rr));
      if (out.r) L.push(fmt(val(out.r, run)));
      const dl = applyFx(out.fx);
      if (dl.length) L.push(deltasHTML(dl));
      if (out.dmg) F.hp -= out.dmg;
      if (out.stance) F.stance = out.stance;
      if (out.hit) hit = true;
      if (out.go || out.endFight) F.done = { type: 'special', sp: mv.special, branch };
      sfx(rr ? (rr.ok ? 'ok' : 'fail') : 'glitch');
    } else {
      const rr = doRoll(mv.stat, modFor(id === 'flee' ? 'flee' : mv.stat), true);
      L.push(rollLine(mv.label, rr));
      if (rr.ok) {
        sfx('ok');
        if (id === 'flee') { F.done = { type: 'flee' }; }
        else if (id === 'cool') { F.done = { type: 'talk' }; L.push(fmt(val((E.txt && E.txt.talk) || '상대가 무기를 내린다. 더 싸울 이유가 없다는 듯이.', run))); }
        else {
          const dmg = 1 + ((E.weak && E.weak[id]) || 0);
          F.hp -= dmg;
          L.push(fmt(pick((E.txt && E.txt[id]) || GENERIC[id])));
        }
      } else {
        sfx('fail'); hit = true;
        L.push(fmt(pick((E.txt && E.txt.miss) || GENERIC.miss)));
      }
    }
    if (hit && !F.done) enemyHit(L);
    endRound(L);
  }
  function fightItem(id) {
    const F = run.fight;
    if (!F || F.done) return;
    const E = D.enemies[F.e], I = D.items[id];
    const k = run.items.indexOf(id);
    if (k < 0 || !I) return;
    run.items.splice(k, 1);
    const L = [`<p class="pick">▸ ${esc(I.name)} 사용</p>`];
    if (I.flee) { F.done = { type: 'flee' }; L.push('<p>연막이 터진다. 회색 장막 속으로 당신이 사라진다.</p>'); sfx('glitch'); }
    else if (I.dmg) {
      const dmg = E.mech && I.mech ? I.mech : I.dmg;
      F.hp -= dmg; L.push(`<p>${esc(I.hitText || '폭발이 적을 집어삼킨다.')} <b class="good">−${dmg}</b></p>`); sfx('hit');
    } else if (I.use) {
      const dl = applyFx(I.use); L.push(deltasHTML(dl)); sfx('heal');
      if (I.use.hp && Math.random() < 0.5) enemyHit(L);
    }
    endRound(L);
  }
  function endRound(L) {
    const F = run.fight, E = D.enemies[F.e];
    if (F.hp <= 0 && !F.done) F.done = { type: 'win' };
    const dd = checkDeath(null);
    if (dd) {
      L.push('<p class="dmg">시야가 붉게 물든다. 몸이 말을 듣지 않는다.</p>');
      F.log.push(L.join('')); F.done = { type: 'death', death: dd };
      saveRun(); render(); return;
    }
    if (F.done) {
      const spec = fightSpec();
      const t = F.done.type;
      if (t === 'win' || t === 'talk') {
        const out = (t === 'talk' && spec.talk) || spec.win || {};
        const loot = E.loot || {};
        const dl = [];
        if (t === 'win') { run.kills += 1; L.push(fmt(val((E.txt && E.txt.win) || '적이 쓰러진다.', run))); }
        let cr = loot.cred ? ri(loot.cred[0], loot.cred[1]) : 0;
        if (t === 'talk') cr = Math.floor(cr / 2);
        const fx = { cred: cr };
        if (t === 'win') { const items = []; (loot.items || []).forEach(([iid, p]) => { if (Math.random() < p) items.push(iid); }); fx.item = items; }
        dl.push(...applyFx(fx));
        run.comps.forEach((c) => { const C = D.comps[c]; if (C.heal) dl.push(...applyFx({ hp: C.heal })); });
        if (out.r) L.push(fmt(val(out.r, run)));
        dl.push(...applyFx(out.fx));
        L.push(deltasHTML(dl));
      } else if (t === 'flee') {
        const out = spec.flee || {};
        L.push(fmt(val(out.r || '당신은 추격을 따돌리고 어둠 속으로 사라진다.', run)));
        const dl = applyFx(out.fx || { heat: 1 });
        L.push(deltasHTML(dl));
      }
      const dd2 = checkDeath(null);
      if (dd2) F.done = { type: 'death', death: dd2 };
    } else {
      F.round += 1;
      F.stance = pick(stanceList(E));
    }
    F.log.push(L.join(''));
    saveRun(); render();
  }
  function fightProceed() {
    const F = run.fight;
    if (!F || !F.done) return;
    if (F.done.type === 'death') { endRun(F.done.death); return; }
    const spec = fightSpec();
    let out = {};
    if (F.done.type === 'win') out = spec.win || {};
    else if (F.done.type === 'talk') out = spec.talk || spec.win || {};
    else if (F.done.type === 'flee') out = spec.flee || {};
    else if (F.done.type === 'special') {
      const sp = D.enemies[F.e].special[F.done.sp];
      out = F.done.branch ? (sp[F.done.branch] || {}) : sp;
    }
    run.fight = null;
    if (out.end) { endRun(val(out.end, run)); return; }
    if (out.go) { const g = val(out.go, run); if (g) { enterScene(g); return; } }
    finishStep();
  }
  function rollLine(label, rr) {
    if (!rr) return `<p class="pick">▸ ${label}</p>`;
    return `<p class="pick">▸ ${label}</p>${rollHTML(rr)}`;
  }

  /* ---------------------------------------------------------------- shop */
  function openShop(kind) {
    run.mode = 'shop';
    run.shop = { kind, stock: genStock(kind), bought: [], therapy: false };
    sfx('cash'); saveRun(); render();
  }
  function genStock(kind) {
    if (kind === 'market') {
      const pool = Object.keys(D.items).filter((id) => { const I = D.items[id]; return I.price && !I.key && (I.minAct || 1) <= Math.max(1, run.act); });
      const stock = ['medkit'];
      const gearHave = new Set(gearIds());
      let guard = 0;
      while (stock.length < 6 && guard++ < 60) {
        const id = wpick(pool, (x) => { const I = D.items[x]; if (stock.includes(x)) return 0; if (I.gear && gearHave.has(x)) return 0; return I.w || 10; });
        if (!id) break;
        stock.push(id);
      }
      return stock;
    }
    const pool = Object.keys(D.ware).filter((id) => !run.ware.includes(id) && (D.ware[id].minAct || 1) <= Math.max(1, run.act));
    const stock = [];
    while (stock.length < 3 && pool.length) { const k = Math.floor(Math.random() * pool.length); stock.push(pool.splice(k, 1)[0]); }
    return stock;
  }
  function buy(x) {
    const sh = run.shop;
    if (!sh) return;
    if (sh.kind === 'market') {
      const I = D.items[x]; const p = price(I.price);
      if (!I || run.cred < p || sh.bought.includes(x)) return;
      run.cred -= p; run.items.push(x); sh.bought.push(x);
      toast(I.name + ' 구입 — ₡' + p);
    } else if (x === 'patch' || x === 'full' || x === 'therapy') {
      if (x === 'patch') { const p = price(20); if (run.cred < p || run.hp >= run.maxhp) return; run.cred -= p; run.hp = Math.min(run.maxhp, run.hp + 6); toast('응급 봉합 — 체력 +6'); }
      if (x === 'full') { const p = price(Math.max(1, (run.maxhp - run.hp) * 3)); if (run.cred < p || run.hp >= run.maxhp) return; run.cred -= p; run.hp = run.maxhp; toast('전신 수복 완료'); }
      if (x === 'therapy') { const p = price(60); if (run.cred < p || sh.therapy || run.hum >= 10) return; run.cred -= p; run.hum += 1; sh.therapy = true; toast('신경 안정 시술 — 인간성 +1'); }
    } else {
      const W = D.ware[x]; const p = price(W.price);
      if (!W || run.cred < p || run.ware.includes(x)) return;
      run.cred -= p; run.hum = Math.max(0, run.hum - W.hum);
      installWare(x, []);
      toast(W.name + ' 시술 완료 — 인간성 −' + W.hum);
      const dd = checkDeath(null);
      if (dd) { run.mode = 'scene'; run.phase = 'result'; run.pending = { death: dd }; run.log.push({ label: esc(W.name) + ' 시술', roll: null, html: fmt('# 경고: 신경 거부 반응. 자아 경계 붕괴.\n크롬이 당신의 마지막 남은 부분을 밀어낸다.'), deltas: [] }); run.shop = null; }
    }
    sfx('cash'); saveRun(); render();
  }
  function sell(idx) {
    const id = run.items[idx]; const I = D.items[id];
    if (!I || I.key || !I.price) return;
    run.items.splice(+idx, 1);
    const p = Math.floor(I.price / 2);
    run.cred += p; toast(I.name + ' 판매 — ₡' + p);
    sfx('cash'); saveRun(); render();
  }
  function leaveShop() { run.shop = null; finishStep(); }
  function useItem(idx) {
    const id = run.items[idx]; const I = D.items[id];
    if (!I || !I.use || I.fightOnly) return;
    if (run.mode === 'fight') return;
    run.items.splice(+idx, 1);
    const d = applyFx(I.use);
    toast(I.name + ' — ' + d.map((x) => x.t).join(', '));
    sfx('heal'); saveRun(); render();
  }

  /* --------------------------------------------------------------- ending */
  function endRun(id) {
    const EN = D.endings[id] || D.endings.flatline;
    const final = !!EN.final;
    const cleared = final ? 3 : Math.max(0, run.act - 1);
    const isNew = !meta.endings[id];
    const br = [];
    br.push(['진행한 구역', run.steps]);
    if (cleared) br.push(['돌파한 막', cleared * 8]);
    if (final) br.push(['결말 도달', EN.type === 'true' ? 40 : 20]);
    if (isNew) br.push(['새로운 결말', 10]);
    if (run.newFrags.length) br.push(['새 기억 파편', run.newFrags.length * 5]);
    if (run.newLore.length) br.push(['새 데이터 파일', run.newLore.length * 2]);
    const total = br.reduce((a, b) => a + b[1], 0);
    meta.echoes += total; meta.totalEchoes += total;
    if (EN.type === 'death') meta.deaths += 1;
    meta.endings[id] = (meta.endings[id] || 0) + 1;
    saveMeta(); store.del(RUN_KEY);
    run.mode = 'end';
    run.ending = { id, br, total, isNew, html: fmt(val(EN.text, run)), epi: final && D.epilogue ? D.epilogue(run, id).map((x) => fmt(x)) : [] };
    sfx(EN.type === 'death' ? 'fail' : 'ok');
    render();
  }

  /* ------------------------------------------------------------ text fmt */
  function inline(t) {
    return t
      .replace(/\{N(으로|이여|은|는|이|가|을|를|과|와|아|야|로)?\}/g, (m, j) => esc(j ? josa(run ? run.name : '', j) : (run ? run.name : '')))
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }
  function fmt(text) {
    if (!text) return '';
    return String(text).split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
      let cls = '', body = ln;
      if (ln.startsWith('> ')) { cls = 'mia'; body = ln.slice(2); }
      else if (ln.startsWith('# ')) { cls = 'sys'; body = ln.slice(2); }
      else if (ln.startsWith('! ')) { cls = 'alert'; body = ln.slice(2); }
      return `<p${cls ? ` class="${cls}"` : ''}>${inline(esc(body))}</p>`;
    }).join('');
  }
  const fmtInline = (t) => inline(esc(t || ''));

  /* ------------------------------------------------------------------ UI */
  let app = null, toastEl = null;
  const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h1v7h-9V7h1zm1.5 0h4V5a2 2 0 0 0-4 0v2z" fill="currentColor"/></svg>';

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function pips(v, max, cls) {
    let h = `<span class="pips ${cls}" aria-hidden="true">`;
    for (let i = 0; i < max; i++) h += `<i class="${i < v ? 'on' : ''}"></i>`;
    return h + '</span>';
  }
  function segments(v, max) {
    let h = '<span class="segs" aria-label="남은 내구도 ' + Math.max(0, v) + '/' + max + '">';
    for (let i = 0; i < max; i++) h += `<i class="${i < v ? 'on' : ''}"></i>`;
    return h + '</span>';
  }
  function deltasHTML(d) {
    if (!d || !d.length) return '';
    let chips = '', frags = '';
    d.forEach((x) => {
      if (x.frag) frags += fragBoxHTML(x.frag, x.isNew);
      else chips += `<span class="chip ${x.cls || ''}">${esc(x.t)}</span>`;
    });
    return (chips ? `<div class="chips">${chips}</div>` : '') + frags;
  }
  function fragBoxHTML(id, isNew) {
    const F = D.frags[id];
    return `<aside class="frag"><div class="frag-head"><span class="eyebrow">미아의 기억 · ${F.no}/7</span><b>${esc(F.title)}</b>${isNew ? '<em>새로운 기억</em>' : '<em class="old">이미 기억하는 조각</em>'}</div><div class="prose">${fmt(F.text)}</div></aside>`;
  }
  function rollHTML(r) {
    return `<div class="roll ${r.ok ? 'ok' : 'no'}"><span class="r-stat">${STAT[r.stat]} 판정</span><span class="r-ch">성공률 ${r.chance}%</span><span class="r-num" data-n="${r.roll}">${r.roll}</span><span class="r-res">${r.ok ? '성공' : '실패'}</span></div>`;
  }

  function actLabel() {
    const A = D.acts[run.act];
    return run.act === 0 ? 'PROLOGUE' : `ACT ${run.act} · ${A.name}`;
  }
  function hudHTML() {
    const O = D.origins[run.origin];
    const hpPct = clamp(run.hp / run.maxhp * 100, 0, 100);
    const crit = run.hp <= Math.ceil(run.maxhp * 0.2);
    const stats = Object.keys(STAT).map((k) => `<span class="stat s-${k}"><small>${STAT[k]}</small>${statVal(k)}</span>`).join('');
    const comps = run.comps.map((c) => `<span class="comp-chip" title="${esc(D.comps[c].desc)}">${esc(D.comps[c].name)}</span>`).join('');
    const buffs = Object.keys(run.buffs).map((b) => `<span class="buff-chip">${esc(BUFF[b])}</span>`).join('');
    return `<header class="hud" aria-label="상태">
      <div class="hud-row">
        <div class="hud-id"><b>${esc(run.name)}</b><span>${esc(O.name)}</span></div>
        <div class="hud-act">${esc(actLabel())}</div>
        <button class="hud-btn" data-a="drawer" aria-label="소지품 열기">소지품 <b>${run.items.length + run.ware.length}</b></button>
      </div>
      <div class="hud-meters">
        <div class="meter hp${crit ? ' crit' : ''}"><span class="m-label">체력</span><span class="bar"><i style="width:${hpPct}%"></i></span><span class="m-val">${Math.max(0, run.hp)}<small>/${run.maxhp}</small></span></div>
        <div class="meter"><span class="m-label">인간성</span>${pips(run.hum, 10, 'soul')}<span class="m-val">${run.hum}</span></div>
        <div class="meter"><span class="m-label">열기</span>${pips(run.heat, 10, 'heat')}<span class="m-val">${run.heat}</span></div>
        <div class="meter"><span class="m-label">유대</span>${pips(run.bond, 10, 'mia')}<span class="m-val">${run.bond}</span></div>
        <div class="meter cred"><span class="m-label">크레딧</span><span class="m-val">₡${run.cred}</span></div>
      </div>
      <div class="hud-stats">${stats}${comps}${buffs}${crit ? '<span class="crit-chip">중상 · 판정 −10%</span>' : ''}</div>
    </header>`;
  }

  function sceneHTML() {
    const key = 's' + run.enterNo;
    const fresh = ui.lastKey !== key;
    const prev = fresh ? 0 : ui.lastLog;
    ui.lastKey = key; ui.lastLog = run.log.length;
    let h = `<article class="scene${fresh ? ' fresh' : ''}">
      <div class="scene-head"><span class="eyebrow">${esc(run.sceneLoc)}</span><h2>${esc(run.sceneTitle)}</h2></div>
      <div class="prose">${run.sceneHTML}</div>${deltasHTML(run.enter)}`;
    run.log.forEach((e, i) => {
      h += `<section class="log${i >= prev ? ' fresh' : ''}"><div class="pick">▸ ${e.label}</div>${e.roll ? rollHTML(e.roll) : ''}<div class="prose">${e.html}</div>${deltasHTML(e.deltas)}</section>`;
    });
    if (run.phase === 'choose') h += choicesHTML();
    else {
      let label = '계속';
      const p = run.pending;
      if (p && p.death) label = '……';
      else if (p) {
        const o = outcomeOf(p);
        if (o.fight) label = '교전 개시';
        else if (o.shop) label = '들어간다';
        else if (o.end) label = '끝까지 간다';
      }
      h += `<div class="actions"><button class="btn primary" data-a="proceed">${label}</button></div>`;
    }
    return h + '</article>';
  }
  function choicesHTML() {
    const list = listChoices();
    let h = '<div class="choices">', n = 0;
    list.forEach((c) => {
      const locked = !c.req.ok;
      if (!locked) n += 1;
      const tags = c.req.labels.filter((l) => l.t).map((l) => `<span class="tag ${l.ok ? 'met' : 'unmet'}">${esc(l.t)}</span>`).join('');
      const odds = c.chance != null ? `<span class="odds s-${c.stat}"><small>${STAT[c.stat]}</small>${c.chance}%</span>` : '';
      h += `<button class="choice${locked ? ' locked' : ''}"${locked ? ' disabled aria-disabled="true"' : ` data-key="${n}"`} data-a="choose" data-x="${c.i}">
        <span class="key">${locked ? LOCK : n}</span><span class="c-body"><span class="c-label">${c.label}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</span>${odds}</button>`;
    });
    return h + '</div>';
  }

  function progressHTML() {
    const A = D.acts[run.act];
    let h = '<div class="prog" aria-label="진행도">';
    A.script.forEach((s, i) => {
      const cls = i < run.step ? 'done' : i === run.step ? 'now' : '';
      const kind = i === A.script.length - 1 ? 'boss' : s ? 'star' : '';
      h += `<i class="${cls} ${kind}"></i>`;
    });
    return h + '</div>';
  }
  function mapHTML() {
    const A = D.acts[run.act];
    const risk = ambushChance();
    let h = `<section class="map">
      <div class="map-head"><div><span class="eyebrow">${run.act === 0 ? 'PROLOGUE' : 'ACT ' + run.act} · ${esc(A.en)}</span><h2>${esc(A.name)}</h2></div>${progressHTML()}</div>
      ${run.ambient ? `<div class="ambient prose">${fmt(run.ambient)}</div>` : ''}
      <div class="map-sub"><span>${run.cards.length > 1 ? '다음 행선지를 고르세요' : '피할 수 없는 길이다'}</span>${run.cards.length > 1 ? `<span class="risk${risk >= 25 ? ' high' : ''}">매복 위험 ${risk}%</span>` : ''}</div>
      <div class="cards${run.cards.length === 1 ? ' single' : ''}">`;
    run.cards.forEach((c, i) => {
      const T = TYPES[c.type];
      const showTitle = c.type !== 'event' && c.type !== 'fight' && c.type !== 'mystery';
      h += `<button class="card t-${c.type}" data-a="card" data-x="${i}" data-key="${i + 1}">
        <span class="card-type"><i></i>${T.label}<small>${T.en}</small></span>
        <span class="card-title">${esc(showTitle ? c.title : c.loc)}</span>
        <span class="card-loc">${esc(showTitle ? c.loc : T.hint)}</span>
        <span class="key">${i + 1}</span></button>`;
    });
    return h + '</div></section>';
  }

  function fightHTML() {
    const F = run.fight, E = D.enemies[F.e], st = D.stances[F.stance] || { t: '' };
    const fk = 'f' + run.enterNo + ':' + F.e;
    if (ui.fightKey !== fk) { ui.fightKey = fk; ui.lastFight = 0; }
    const freshFrom = ui.lastFight;
    ui.lastFight = F.log.length;
    let h = `<section class="fight${E.boss ? ' boss' : ''}">
      <div class="foe"><span class="eyebrow">${E.boss ? 'CRISIS' : 'HOSTILE'} · ${esc(E.en || '')}</span><h2>${esc(E.name)}</h2>
      <div class="foe-hp"><span class="m-label">내구도</span>${segments(F.hp, F.max)}</div>
      ${E.desc ? `<p class="foe-desc">${esc(E.desc)}</p>` : ''}</div>
      <div class="flog">`;
    const start = Math.max(0, F.log.length - 6);
    F.log.slice(start).forEach((x, i) => { h += `<div class="fl${start + i >= freshFrom ? ' fresh' : ''}">${x}</div>`; });
    h += '</div>';
    if (F.done) {
      h += `<div class="actions"><button class="btn primary" data-a="fproceed">${F.done.type === 'death' ? '……' : '계속'}</button></div>`;
    } else {
      h += `<div class="stance"><span class="eyebrow">ROUND ${F.round}</span>${fmtInline(st.t)}</div><div class="moves">`;
      let n = 0;
      fightMoves().forEach((m) => {
        const locked = m.req && !m.req.ok;
        if (!locked) n += 1;
        const tags = m.req ? m.req.labels.filter((l) => l.t).map((l) => `<span class="tag ${l.ok ? 'met' : 'unmet'}">${esc(l.t)}</span>`).join('') : '';
        h += `<button class="choice move${m.special != null ? ' special' : ''}${locked ? ' locked' : ''}"${locked ? ' disabled' : ` data-key="${n}"`} data-a="fight" data-x="${m.id}">
          <span class="key">${locked ? LOCK : n}</span><span class="c-body"><span class="c-label">${fmtInline(m.label)}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</span>
          ${m.chance != null ? `<span class="odds s-${m.stat}"><small>${STAT[m.stat]}</small>${m.chance}%</span>` : ''}</button>`;
      });
      h += '</div>';
      const seen = {};
      run.items.forEach((id) => { const I = D.items[id]; if (I && (I.fightOnly || (I.use && I.fight))) seen[id] = (seen[id] || 0) + 1; });
      const ids = Object.keys(seen);
      if (ids.length) {
        h += '<div class="fitems"><span class="eyebrow">아이템 사용</span><div class="fitem-row">';
        ids.forEach((id) => { h += `<button class="pill" data-a="fitem" data-x="${id}">${esc(D.items[id].name)}${seen[id] > 1 ? ' ×' + seen[id] : ''}<small>${esc(D.items[id].desc)}</small></button>`; });
        h += '</div></div>';
      }
      h += `<p class="armor-note">방어력 ${armor()} · 실패하면 적이 반격한다</p>`;
    }
    return h + '</section>';
  }

  function shopHTML() {
    const sh = run.shop;
    const sc = D.scenes[run.scene];
    let h = `<section class="shop"><div class="scene-head"><span class="eyebrow">${sh.kind === 'market' ? 'MARKET' : 'CLINIC'} · ${esc(run.sceneLoc)}</span><h2>${esc(run.sceneTitle)}</h2></div>
      <p class="shop-note">보유 크레딧 <b>₡${run.cred}</b>${D.origins[run.origin].perk && D.origins[run.origin].perk.shop ? ' · 협잡꾼 흥정 −20% 적용' : ''}</p>`;
    if (sh.kind === 'market') {
      h += '<h3 class="sub">구매</h3><div class="wares">';
      sh.stock.forEach((id) => {
        const I = D.items[id], p = price(I.price), sold = sh.bought.includes(id);
        h += `<div class="ware"><div><b>${esc(I.name)}</b>${I.gear ? '<span class="tag met">장비</span>' : ''}<p>${esc(I.desc)}</p></div>
          <button class="btn small" data-a="buy" data-x="${id}" ${sold || run.cred < p ? 'disabled' : ''}>${sold ? '구입함' : '₡' + p}</button></div>`;
      });
      h += '</div>';
      const sellable = run.items.map((id, i) => ({ id, i, I: D.items[id] })).filter((x) => x.I && !x.I.key && x.I.price);
      if (sellable.length) {
        h += '<h3 class="sub">판매</h3><div class="wares">';
        sellable.forEach((x) => { h += `<div class="ware"><div><b>${esc(x.I.name)}</b><p>${esc(x.I.desc)}</p></div><button class="btn small ghost" data-a="sell" data-x="${x.i}">₡${Math.floor(x.I.price / 2)}에 판다</button></div>`; });
        h += '</div>';
      }
    } else {
      const pp = price(20), pf = price(Math.max(1, (run.maxhp - run.hp) * 3)), pt = price(60);
      h += `<h3 class="sub">치료</h3><div class="wares">
        <div class="ware"><div><b>응급 봉합</b><p>체력 +6</p></div><button class="btn small" data-a="buy" data-x="patch" ${run.cred < pp || run.hp >= run.maxhp ? 'disabled' : ''}>₡${pp}</button></div>
        <div class="ware"><div><b>전신 수복</b><p>체력을 최대치까지 (${run.hp}/${run.maxhp})</p></div><button class="btn small" data-a="buy" data-x="full" ${run.cred < pf || run.hp >= run.maxhp ? 'disabled' : ''}>₡${pf}</button></div>
        <div class="ware"><div><b>신경 안정 시술</b><p>인간성 +1 · 방문당 1회</p></div><button class="btn small" data-a="buy" data-x="therapy" ${run.cred < pt || sh.therapy || run.hum >= 10 ? 'disabled' : ''}>${sh.therapy ? '완료' : '₡' + pt}</button></div>
      </div><h3 class="sub">사이버웨어 시술</h3><div class="wares">`;
      if (!sh.stock.length) h += '<p class="shop-note">설치할 수 있는 크롬이 없다.</p>';
      sh.stock.forEach((id) => {
        const W = D.ware[id], p = price(W.price), done = run.ware.includes(id);
        h += `<div class="ware"><div><b>${esc(W.name)}</b><span class="tag unmet">인간성 −${W.hum}</span><p>${esc(W.desc)}</p></div>
          <button class="btn small" data-a="buy" data-x="${id}" ${done || run.cred < p ? 'disabled' : ''}>${done ? '설치됨' : '₡' + p}</button></div>`;
      });
      h += '</div>';
      if (run.hum <= 3) h += '<p class="warn">! 인간성이 위험할 만큼 낮다. 크롬이 당신을 밀어내고 있다.</p>';
    }
    void sc;
    h += '<div class="actions"><button class="btn primary" data-a="leaveShop">떠난다</button></div></section>';
    return h;
  }

  function actHTML() {
    const A = D.acts[run.act];
    return `<section class="act-card">
      <span class="eyebrow">${run.act === 0 ? 'PROLOGUE' : 'ACT ' + run.act}</span>
      <h1 class="act-title">${esc(A.name)}</h1><div class="act-en">${esc(A.en)}</div>
      ${A.time ? `<div class="act-time">${esc(A.time)}</div>` : ''}
      <div class="prose">${fmt(val(A.intro, run))}</div>
      ${A.goal ? `<div class="goal"><span class="eyebrow">목표</span>${esc(A.goal)}</div>` : ''}
      ${run.unlockMsg ? `<div class="unlock">${esc(run.unlockMsg)}</div>` : ''}
      <div class="actions"><button class="btn primary" data-a="actgo">${run.act === 0 ? '시작' : '진입'}</button></div>
    </section>`;
  }

  function drawerHTML() {
    const items = {};
    run.items.forEach((id, i) => { if (!items[id]) items[id] = { n: 0, i }; items[id].n += 1; });
    let h = `<div class="drawer-bg" data-a="drawer"></div><aside class="drawer" role="dialog" aria-label="소지품">
      <div class="drawer-head"><h2>소지품</h2><button class="btn small ghost" data-a="drawer">닫기</button></div>`;
    const ids = Object.keys(items);
    h += '<h3 class="sub">아이템</h3>';
    if (!ids.length) h += '<p class="muted">가진 것이 없다.</p>';
    ids.forEach((id) => {
      const I = D.items[id], it = items[id];
      const usable = I.use && !I.fightOnly && run.mode !== 'fight';
      h += `<div class="ware"><div><b>${esc(I.name)}${it.n > 1 ? ' ×' + it.n : ''}</b>${I.key ? '<span class="tag met">핵심</span>' : I.gear ? '<span class="tag met">장비</span>' : ''}<p>${esc(I.desc)}</p></div>
        ${usable ? `<button class="btn small" data-a="use" data-x="${it.i}">사용</button>` : ''}</div>`;
    });
    h += '<h3 class="sub">사이버웨어</h3>';
    if (!run.ware.length) h += '<p class="muted">순정 육체. 아직은.</p>';
    run.ware.forEach((w) => { const W = D.ware[w]; h += `<div class="ware"><div><b>${esc(W.name)}</b><p>${esc(W.desc)}</p></div></div>`; });
    h += '<h3 class="sub">동료</h3>';
    if (!run.comps.length) h += '<p class="muted">혼자다. 머릿속의 목소리를 빼면.</p>';
    run.comps.forEach((c) => { const C = D.comps[c]; h += `<div class="ware"><div><b>${esc(C.name)}</b><span class="tag met">${esc(C.role)}</span><p>${esc(C.desc)}</p></div></div>`; });
    const O = D.origins[run.origin];
    h += `<h3 class="sub">출신 특성</h3><p class="muted">${esc(O.name)} — ${esc(O.perkText)}</p>`;
    h += `<p class="muted small">시뮬레이션 #${pad(run.runNo)} · 처치 ${run.kills}</p></aside>`;
    return h;
  }

  function endingHTML() {
    const E = run.ending, EN = D.endings[E.id] || D.endings.flatline;
    const death = EN.type === 'death';
    let h = `<section class="ending ${death ? 'death' : 'final'} e-${EN.type}">`;
    if (death) h += `<div class="sig">SIGNAL LOST · 미래 #${pad(run.runNo)} 폐기</div>`;
    else h += `<div class="sig">ENDING · ${esc(EN.en || '')}</div>`;
    h += `<h1 class="end-title">${esc(EN.title)}</h1>${E.isNew ? '<div class="unlock">새로운 결말</div>' : ''}<div class="prose">${E.html}</div>`;
    if (death && D.deathLines) h += `<div class="prose whisper">${fmt(D.deathLines(meta.deaths, run))}</div>`;
    if (E.epi.length) h += `<div class="epi"><span class="eyebrow">그 후</span>${E.epi.join('')}</div>`;
    h += `<div class="summary"><span class="eyebrow">시뮬레이션 #${pad(run.runNo)} 기록</span>
      <dl><div><dt>도달</dt><dd>${run.act === 0 ? '프롤로그' : 'ACT ' + run.act}</dd></div><div><dt>처치</dt><dd>${run.kills}</dd></div>
      <div><dt>유대</dt><dd>${run.bond}</dd></div><div><dt>인간성</dt><dd>${run.hum}</dd></div>
      <div><dt>동료</dt><dd>${run.comps.length ? run.comps.map((c) => esc(D.comps[c].name)).join(', ') : '없음'}</dd></div></dl></div>`;
    h += `<div class="echo"><span class="eyebrow">획득한 에코</span><ul>${E.br.map((b) => `<li><span>${b[0]}</span><b>+${b[1]}</b></li>`).join('')}</ul><div class="echo-total">합계 <b>+${E.total}</b> · 보유 ${meta.echoes}</div></div>`;
    h += `<div class="actions"><button class="btn primary" data-a="newgame">다시 시뮬레이션</button><button class="btn" data-a="upgrades">에코 강화</button><button class="btn ghost" data-a="title">타이틀로</button></div></section>`;
    return h;
  }

  function titleHTML() {
    const hasSave = !!store.get(RUN_KEY);
    const fc = NR.fragCount(), ec = Object.keys(D.endings).filter((k) => meta.endings[k]).length;
    return `<section class="title">
      <div class="sim-id">CASSANDRA PREDICTIVE ENGINE · SIMULATION #${pad(meta.runs + 1)}</div>
      <h1 class="logo"><span class="logo-ko" data-text="네온 레퀴엠">네온 레퀴엠</span><span class="logo-en">NEON REQUIEM</span></h1>
      <p class="tagline">2083년, 자유도시 할시온. 당신의 손목에는 은색 케이스가, 당신의 머릿속에는 아홉 살 아이의 목소리가 있다. 도시가 모든 기억을 잃기까지 사흘.</p>
      <nav class="menu">
        ${hasSave ? '<button class="btn primary" data-a="continue">이어하기</button>' : ''}
        <button class="btn${hasSave ? '' : ' primary'}" data-a="newgame">새 시뮬레이션</button>
        <button class="btn" data-a="upgrades">에코 강화<b>${meta.echoes}</b></button>
        <button class="btn" data-a="archive">기록 보관소<b>${fc}/7 · ${ec}/${Object.keys(D.endings).length}</b></button>
        <button class="btn ghost" data-a="settings">설정</button>
      </nav>
      <dl class="title-stats"><div><dt>시뮬레이션</dt><dd>${meta.runs}</dd></div><div><dt>폐기된 미래</dt><dd>${meta.deaths}</dd></div><div><dt>최고 도달</dt><dd>${meta.bestAct ? 'ACT ' + meta.bestAct : '—'}</dd></div></dl>
      <p class="howto">선택지는 숫자 키로도 고를 수 있습니다. 판정은 표시된 성공률대로 굴러갑니다. 죽으면 처음부터 — 하지만 에코와 기억은 남습니다.</p>
    </section>`;
  }

  function setupHTML() {
    const names = D.names;
    if (!ui.origin) ui.origin = 'merc';
    let h = `<section class="setup"><span class="eyebrow">NEW SIMULATION</span><h2>운반책 등록</h2>
      <label class="field" for="handle"><span>콜사인</span><input id="handle" name="handle" maxlength="10" autocomplete="off" value="${esc(ui.handle || pick(names))}"><button class="btn small ghost" data-a="randname" type="button">무작위</button></label>
      <h3 class="sub">출신</h3><div class="origins">`;
    Object.keys(D.origins).forEach((id) => {
      const O = D.origins[id];
      const locked = O.locked && !meta.unlocked[id];
      h += `<button class="origin${ui.origin === id ? ' sel' : ''}${locked ? ' locked' : ''}" data-a="origin" data-x="${id}" ${locked ? 'disabled' : ''} aria-pressed="${ui.origin === id}">
        <span class="o-en">${esc(O.en)}</span><b>${esc(O.name)}</b>
        <span class="o-desc">${esc(locked ? O.lockText : O.desc)}</span>
        ${locked ? '' : `<span class="o-stats">${Object.keys(STAT).map((k) => `<span class="s-${k}"><small>${STAT[k]}</small>${O.stats[k]}</span>`).join('')}</span>
        <span class="o-meta">체력 ${O.hp + (meta.upgrades.body ? 3 : 0)} · ₡${O.cred + (meta.upgrades.stash ? 50 : 0)} · 인간성 ${O.hum}</span>
        <span class="o-perk">${esc(O.perkText)}</span>`}</button>`;
    });
    h += `</div><div class="actions"><button class="btn primary" data-a="start">시뮬레이션 시작</button><button class="btn ghost" data-a="title">돌아가기</button></div></section>`;
    return h;
  }

  function archiveHTML() {
    const tabs = [['frags', '미아의 기억'], ['lore', '데이터 파일'], ['endings', '결말'], ['stats', '통계']];
    let h = `<section class="archive"><span class="eyebrow">ARCHIVE</span><h2>기록 보관소</h2><div class="tabs" role="tablist">`;
    tabs.forEach(([k, l]) => { h += `<button role="tab" aria-selected="${ui.tab === k}" class="tab${ui.tab === k ? ' on' : ''}" data-a="tab" data-x="${k}">${l}</button>`; });
    h += '</div><div class="tab-body">';
    if (ui.tab === 'frags') {
      h += `<p class="muted">케이스 속 아이가 떠올린 기억들. 일곱 조각을 모두 모으면, 그녀가 숨기고 있던 이야기가 열린다.</p>`;
      Object.keys(D.frags).sort((a, b) => D.frags[a].no - D.frags[b].no).forEach((id) => {
        const F = D.frags[id];
        h += meta.frags[id] ? fragBoxHTML(id, false).replace('<em class="old">이미 기억하는 조각</em>', '') : `<aside class="frag lockedf"><div class="frag-head"><span class="eyebrow">미아의 기억 · ${F.no}/7</span><b>???</b></div><p class="muted">${esc(F.hint)}</p></aside>`;
      });
    } else if (ui.tab === 'lore') {
      Object.keys(D.lore).forEach((id) => {
        const L = D.lore[id];
        h += meta.lore[id] ? `<details class="lore"><summary><span class="eyebrow">${esc(L.cat)}</span>${esc(L.title)}</summary><div class="prose">${fmt(L.text)}</div></details>` : `<div class="lore locked"><span class="eyebrow">${esc(L.cat)}</span>잠긴 파일</div>`;
      });
    } else if (ui.tab === 'endings') {
      Object.keys(D.endings).forEach((id) => {
        const EN = D.endings[id];
        const seen = meta.endings[id];
        h += `<div class="end-row${seen ? ' seen' : ''} e-${EN.type}"><div><span class="eyebrow">${esc(EN.en || '')}</span><b>${seen ? esc(EN.title) : '???'}</b><p>${esc(seen ? EN.blurb : EN.hint)}</p></div>${seen ? `<span class="count">${seen}회</span>` : ''}</div>`;
      });
    } else {
      h += `<dl class="stats-grid"><div><dt>시뮬레이션</dt><dd>${meta.runs}</dd></div><div><dt>폐기된 미래</dt><dd>${meta.deaths}</dd></div>
        <div><dt>누적 에코</dt><dd>${meta.totalEchoes}</dd></div><div><dt>최고 도달</dt><dd>${meta.bestAct ? 'ACT ' + meta.bestAct : '—'}</dd></div>
        <div><dt>기억 파편</dt><dd>${NR.fragCount()}/7</dd></div><div><dt>데이터 파일</dt><dd>${Object.keys(D.lore).filter((k) => meta.lore[k]).length}/${Object.keys(D.lore).length}</dd></div></dl>`;
    }
    h += '</div><div class="actions"><button class="btn ghost" data-a="title">돌아가기</button></div></section>';
    return h;
  }

  function upgradesHTML() {
    let h = `<section class="upgrades"><span class="eyebrow">ECHO</span><h2>에코 강화</h2>
      <p class="muted">폐기된 미래들이 남긴 잔향. 다음 시뮬레이션의 당신에게 스며든다. 보유 에코 <b class="echo-bal">${meta.echoes}</b></p><div class="wares">`;
    Object.keys(D.upgrades).forEach((id) => {
      const U = D.upgrades[id], own = meta.upgrades[id];
      h += `<div class="ware${own ? ' owned' : ''}"><div><b>${esc(U.name)}</b><p>${esc(U.desc)}</p></div>
        <button class="btn small" data-a="buyUp" data-x="${id}" ${own || meta.echoes < U.cost ? 'disabled' : ''}>${own ? '적용 중' : U.cost + ' 에코'}</button></div>`;
    });
    h += '</div><div class="actions"><button class="btn ghost" data-a="title">돌아가기</button></div></section>';
    return h;
  }

  function settingsHTML() {
    const s = meta.settings;
    return `<section class="settings"><span class="eyebrow">SETTINGS</span><h2>설정</h2>
      <div class="wares">
        <div class="ware"><div><b>효과음</b><p>클릭, 판정, 피격 소리</p></div><button class="btn small" data-a="toggle" data-x="sound" aria-pressed="${s.sound}">${s.sound ? '켜짐' : '꺼짐'}</button></div>
        <div class="ware"><div><b>움직임 효과</b><p>비 내리는 배경과 글자 연출</p></div><button class="btn small" data-a="toggle" data-x="motion" aria-pressed="${s.motion}">${s.motion ? '켜짐' : '꺼짐'}</button></div>
        <div class="ware"><div><b>기록 초기화</b><p>에코, 기억, 결말, 진행 중인 시뮬레이션을 모두 지운다</p></div>
          ${ui.confirm === 'reset' ? '<button class="btn small danger" data-a="reset">정말 지운다</button>' : '<button class="btn small ghost" data-a="askReset">초기화</button>'}</div>
      </div>
      <p class="muted small">진행 기록은 이 브라우저에만 저장됩니다. 시크릿 창이나 저장소가 차단된 환경에서는 새로고침하면 사라집니다.</p>
      <div class="actions"><button class="btn ghost" data-a="title">돌아가기</button></div></section>`;
  }

  function render() {
    if (!app) return;
    const view = ui.view === 'run' && run ? 'run:' + run.mode : ui.view;
    const changed = view !== ui.lastView;
    let h = '';
    if (ui.view === 'run' && run) {
      if (run.mode === 'end') h = endingHTML();
      else {
        h = hudHTML() + '<div class="stage">';
        if (run.mode === 'act') h += actHTML();
        else if (run.mode === 'map') h += mapHTML();
        else if (run.mode === 'scene') h += sceneHTML();
        else if (run.mode === 'fight') h += fightHTML();
        else if (run.mode === 'shop') h += shopHTML();
        h += '</div>';
        if (ui.drawer) h += drawerHTML();
      }
    } else if (ui.view === 'setup') h = setupHTML();
    else if (ui.view === 'archive') h = archiveHTML();
    else if (ui.view === 'upgrades') h = upgradesHTML();
    else if (ui.view === 'settings') h = settingsHTML();
    else h = titleHTML();
    app.innerHTML = h;
    app.dataset.view = view;
    document.body.classList.toggle('still', !meta.settings.motion);
    afterRender(changed);
    ui.lastView = view;
  }
  function afterRender(changed) {
    const logEntry = app.querySelector('.log.fresh');
    const fightEntry = app.querySelector('.fl.fresh:last-child');
    const behavior = meta.settings.motion ? 'smooth' : 'auto';
    if (changed || (run && run.mode === 'scene' && app.querySelector('.scene.fresh'))) window.scrollTo(0, 0);
    else if (logEntry) { try { logEntry.scrollIntoView({ behavior, block: 'start' }); } catch (e) { logEntry.scrollIntoView(); } }
    else if (fightEntry) { const mv = app.querySelector('.moves, .fight .actions'); const t = mv || fightEntry; try { t.scrollIntoView({ behavior, block: 'nearest' }); } catch (e) { t.scrollIntoView(); } }
    if (meta.settings.motion) {
      app.querySelectorAll('.fresh .r-num').forEach((el) => {
        const n = el.dataset.n; let k = 0;
        const t = setInterval(() => { el.textContent = String(ri(1, 100)); if (++k > 9) { clearInterval(t); el.textContent = n; el.classList.add('land'); } }, 38);
      });
    }
  }

  /* ------------------------------------------------------------- actions */
  const ACTIONS = {
    newgame() { ui.view = 'setup'; ui.handle = null; render(); },
    continue() {
      const s = store.get(RUN_KEY);
      if (!s || !s.mode) { toast('이어할 시뮬레이션이 없다.'); return; }
      run = s; ui.view = 'run'; ui.lastKey = ''; ui.drawer = false; render();
    },
    title() { ui.view = 'title'; ui.confirm = null; ui.drawer = false; render(); },
    archive() { ui.view = 'archive'; render(); },
    upgrades() { ui.view = 'upgrades'; render(); },
    settings() { ui.view = 'settings'; ui.confirm = null; render(); },
    tab(x) { ui.tab = x; render(); },
    origin(x) { const inp = document.getElementById('handle'); if (inp) ui.handle = inp.value; ui.origin = x; render(); },
    randname() { ui.handle = pick(D.names); render(); },
    start() {
      const inp = document.getElementById('handle');
      let name = (inp && inp.value || '').trim().replace(/\s+/g, ' ').slice(0, 10);
      if (!name) name = pick(D.names);
      const O = D.origins[ui.origin];
      if (!O || (O.locked && !meta.unlocked[ui.origin])) return;
      run = newRun(name, ui.origin); ui.view = 'run'; ui.lastKey = ''; ui.drawer = false;
      beginAct(0);
    },
    actgo() { run.unlockMsg = null; sfx('glitch'); prepareStep(true); },
    card(x) { chooseCard(+x); },
    choose(x) { choose(+x); },
    proceed() { proceed(); },
    fight(x) { fightAct(x); },
    fitem(x) { fightItem(x); },
    fproceed() { fightProceed(); },
    buy(x) { buy(x); },
    sell(x) { sell(+x); },
    leaveShop() { leaveShop(); },
    drawer() { ui.drawer = !ui.drawer; render(); },
    use(x) { useItem(+x); },
    buyUp(x) {
      const U = D.upgrades[x];
      if (!U || meta.upgrades[x] || meta.echoes < U.cost) return;
      meta.echoes -= U.cost; meta.upgrades[x] = 1; saveMeta(); sfx('ok'); toast(U.name + ' — 다음 시뮬레이션부터 적용'); render();
    },
    toggle(x) { meta.settings[x] = !meta.settings[x]; saveMeta(); if (x === 'motion') rain.toggle(); render(); },
    askReset() { ui.confirm = 'reset'; render(); },
    reset() { meta = freshMeta(); saveMeta(); store.del(RUN_KEY); run = null; ui.confirm = null; toast('모든 기록을 지웠다.'); ui.view = 'title'; render(); },
  };

  /* ---------------------------------------------------------------- sound */
  let actx = null;
  function sfx(type) {
    if (!meta.settings.sound || NR.headless) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const tone = (f, dur, wave, vol, at, slide) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = wave; o.frequency.setValueAtTime(f, t + at);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + at + dur);
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(vol, t + at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        o.connect(g); g.connect(actx.destination); o.start(t + at); o.stop(t + at + dur + 0.02);
      };
      if (type === 'click') tone(620, 0.04, 'square', 0.025, 0);
      else if (type === 'ok') { tone(660, 0.09, 'sine', 0.05, 0); tone(990, 0.14, 'sine', 0.045, 0.07); }
      else if (type === 'fail') tone(180, 0.22, 'sawtooth', 0.035, 0, 90);
      else if (type === 'hit') tone(110, 0.18, 'square', 0.05, 0, 55);
      else if (type === 'heal') { tone(520, 0.1, 'triangle', 0.04, 0); tone(780, 0.16, 'triangle', 0.04, 0.08); }
      else if (type === 'cash') tone(1400, 0.06, 'triangle', 0.03, 0);
      else if (type === 'glitch') { tone(240, 0.05, 'square', 0.03, 0, 900); tone(900, 0.05, 'square', 0.02, 0.05, 200); }
    } catch (e) { /* 오디오 사용 불가 */ }
  }

  /* ----------------------------------------------------------------- rain */
  const rain = {
    on: false, ctx: null, c: null, drops: [], w: 0, h: 0, raf: 0,
    init() {
      this.c = document.getElementById('rain');
      if (!this.c) return;
      this.ctx = this.c.getContext('2d');
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        this.w = this.c.width = Math.floor(window.innerWidth * dpr);
        this.h = this.c.height = Math.floor(window.innerHeight * dpr);
        const n = Math.min(140, Math.floor(window.innerWidth / 9));
        this.drops = Array.from({ length: n }, () => this.drop(true));
      };
      window.addEventListener('resize', resize);
      resize();
      if (meta.settings.motion) this.start(); else this.still();
    },
    drop(any) {
      return { x: Math.random() * this.w * 1.2, y: any ? Math.random() * this.h : -20, l: 10 + Math.random() * 26, v: 6 + Math.random() * 9, a: 0.08 + Math.random() * 0.22, m: Math.random() < 0.12 };
    },
    start() {
      this.on = true;
      const step = () => {
        if (!this.on) return;
        const g = this.ctx; g.clearRect(0, 0, this.w, this.h);
        g.lineWidth = 1;
        for (const d of this.drops) {
          g.strokeStyle = d.m ? `rgba(255,63,142,${d.a})` : `rgba(92,242,220,${d.a * 0.8})`;
          g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * 0.22, d.y + d.l); g.stroke();
          d.y += d.v; d.x -= d.v * 0.22;
          if (d.y > this.h + 30) Object.assign(d, this.drop(false));
        }
        this.raf = requestAnimationFrame(step);
      };
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(step);
    },
    still() {
      this.on = false; cancelAnimationFrame(this.raf);
      if (!this.ctx) return;
      const g = this.ctx; g.clearRect(0, 0, this.w, this.h);
      for (const d of this.drops) { g.strokeStyle = `rgba(92,242,220,${d.a * 0.5})`; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * 0.22, d.y + d.l); g.stroke(); }
    },
    toggle() { if (meta.settings.motion) this.start(); else this.still(); },
  };

  /* ----------------------------------------------------------------- boot */
  NR.boot = function () {
    app = document.getElementById('app');
    toastEl = document.getElementById('toast');
    app.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || b.disabled || !app.contains(b)) return;
      const fn = ACTIONS[b.dataset.a];
      if (fn) fn(b.dataset.x, b);
    });
    document.addEventListener('keydown', (e) => {
      const tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && ui.drawer) { ui.drawer = false; render(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const scope = ui.drawer ? null : app.querySelector('.choices, .cards, .moves');
        const btn = scope && scope.querySelector(`[data-key="${e.key}"]`);
        if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      } else if (e.key === 'Enter' && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
        const p = app.querySelector('.actions .btn.primary');
        if (p) { e.preventDefault(); p.click(); }
      }
    });
    rain.init();
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.snapshot === 'function') {
      try { hot.snapshot(() => ({ run, view: ui.view })); } catch (e) { /* 무시 */ }
    }
    const start = (data) => {
      if (data && data.run && data.run.mode) { run = data.run; ui.view = data.view || 'run'; }
      render();
    };
    if (hot && typeof hot.ready === 'function') hot.ready(start);
    else start((hot && hot.data) || {});
  };

  /* 헤드리스 테스트용 코어 API */
  NR.core = {
    newRun, beginAct, prepareStep, chooseCard, enterScene, listChoices, choose, proceed,
    fightMoves, fightAct, fightItem, fightProceed, openShop, buy, sell, leaveShop, useItem, endRun,
    calcChance, reqCheck, applyFx, price,
    get run() { return run; }, set run(v) { run = v; },
    get meta() { return meta; }, set meta(v) { meta = v; },
    TYPES, STAT,
  };
})();
