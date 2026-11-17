#!/usr/bin/env node
/* NEON REQUIEM — 데이터 검증기 + 자동 플레이 봇
   사용법:
     node tools/check.js                 정적 검증만
     node tools/check.js --sim 2000      무작위·전략 봇으로 각각 2000판
     node tools/check.js --campaign 40   메타 진행을 누적하며 40판씩 캠페인 20회
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
files.forEach((f) => { require(path.join(ROOT, f)); });
const NR = global.NR;
NR.headless = true;
const D = NR.D, C = NR.core;
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };

/* =========================================================== 정적 검증 */
const errors = [], warns = [];
const flagsSet = new Set(['_pump']), flagsReq = new Map(), flagsRead = new Map();
const STATS = ['body', 'reflex', 'net', 'cool'];
const noteRead = (fn, ctx) => {
  if (typeof fn !== 'function') return;
  for (const m of fn.toString().matchAll(/flags\.(\w+)/g)) flagsRead.set(m[1], ctx);
};
function visitFx(fx, ctx) {
  if (typeof fx === 'function') { noteRead(fx, ctx); try { fx = fx({ flags: {}, vars: {}, items: [], comps: [], stats: {}, act: 1 }); } catch (e) { return; } }
  if (!fx) return;
  const known = ['hp', 'maxhp', 'hum', 'cred', 'heat', 'bond', 'stat', 'item', 'drop', 'ware', 'flag', 'unflag', 'v', 'comp', 'leave', 'kill', 'buff', 'lore', 'frag'];
  Object.keys(fx).forEach((k) => { if (!known.includes(k)) errors.push(`${ctx}: 알 수 없는 fx 키 "${k}"`); });
  arr(fx.item).concat(arr(fx.drop)).forEach((id) => { if (!D.items[id]) errors.push(`${ctx}: 없는 아이템 ${id}`); });
  arr(fx.ware).forEach((id) => { if (!D.ware[id]) errors.push(`${ctx}: 없는 사이버웨어 ${id}`); });
  arr(fx.comp).concat(arr(fx.leave), arr(fx.kill)).forEach((id) => { if (!D.comps[id]) errors.push(`${ctx}: 없는 동료 ${id}`); });
  arr(fx.lore).forEach((id) => { if (!D.lore[id]) errors.push(`${ctx}: 없는 데이터 파일 ${id}`); });
  arr(fx.frag).forEach((id) => { if (!D.frags[id]) errors.push(`${ctx}: 없는 기억 ${id}`); });
  arr(fx.buff).forEach((b) => { if (!['stim', 'ice'].includes(b)) errors.push(`${ctx}: 없는 버프 ${b}`); });
  if (fx.stat) Object.keys(fx.stat).forEach((k) => { if (!STATS.includes(k)) errors.push(`${ctx}: 없는 능력치 ${k}`); });
  arr(fx.flag).forEach((f) => flagsSet.add(f));
  arr(fx.kill).forEach((c) => flagsSet.add('dead_' + c));
}
function visitReq(r, ctx) {
  if (!r) return;
  arr(r.item).forEach((id) => { if (!D.items[id]) errors.push(`${ctx}: req 없는 아이템 ${id}`); });
  arr(r.ware).forEach((id) => { if (!D.ware[id]) errors.push(`${ctx}: req 없는 사이버웨어 ${id}`); });
  arr(r.comp).forEach((id) => { if (!D.comps[id]) errors.push(`${ctx}: req 없는 동료 ${id}`); });
  if (r.origin && !D.origins[r.origin]) errors.push(`${ctx}: req 없는 출신 ${r.origin}`);
  if (r.stat) Object.keys(r.stat).forEach((k) => { if (!STATS.includes(k)) errors.push(`${ctx}: req 없는 능력치 ${k}`); });
  arr(r.flag).forEach((f) => { flagsReq.set(f, ctx); if (!D.flagNames[f]) warns.push(`${ctx}: req 플래그 "${f}"에 표시명이 없어 잠금 이유가 안 보임`); });
  arr(r.noflag).forEach((f) => flagsReq.set(f, ctx));
}
function visitFight(f, ctx) {
  if (typeof f === 'function') return;
  const spec = typeof f === 'string' ? { e: f } : f;
  if (!D.enemies[spec.e]) { errors.push(`${ctx}: 없는 적 ${spec.e}`); return; }
  ['win', 'talk', 'flee'].forEach((k) => { if (spec[k]) visitOutcome(spec[k], `${ctx}.${k}`); });
}
function visitGo(g, ctx) {
  if (typeof g === 'function') { noteRead(g, ctx); return; }
  if (!D.scenes[g]) errors.push(`${ctx}: 없는 장면 ${g}`);
}
function visitOutcome(o, ctx) {
  if (!o) return;
  ['if', 't', 'r'].forEach((k) => noteRead(o[k], ctx));
  if (o.fx) visitFx(o.fx, ctx);
  if (o.req) visitReq(o.req, ctx);
  if (o.check) {
    if (!STATS.includes(o.check[0])) errors.push(`${ctx}: 판정 능력치 ${o.check[0]}`);
    if (!o.ok || !o.no) errors.push(`${ctx}: 판정에 ok/no 결과가 모두 있어야 함`);
    noteRead(o.check[1], ctx);
  }
  if (o.go) visitGo(o.go, ctx);
  if (o.end && typeof o.end !== 'function' && !D.endings[o.end]) errors.push(`${ctx}: 없는 결말 ${o.end}`);
  if (o.shop && !['market', 'clinic'].includes(o.shop)) errors.push(`${ctx}: 상점 종류 ${o.shop}`);
  if (o.fight) visitFight(o.fight, ctx);
  if (o.ok) visitOutcome(o.ok, ctx + '.ok');
  if (o.no) visitOutcome(o.no, ctx + '.no');
  if (o.check && (o.fx || o.go || o.fight || o.end || o.r)) warns.push(`${ctx}: 판정 선택지의 최상위 결과 필드는 무시됨`);
}
Object.values(D.scenes).forEach((sc) => {
  const ctx = 'scene ' + sc.id;
  if (!sc.choices || !sc.choices.length) errors.push(`${ctx}: 선택지 없음`);
  ['text', 'cond', 'title', 'loc'].forEach((k) => noteRead(sc[k], ctx));
  if (sc.onEnter) visitFx(sc.onEnter, ctx + '.onEnter');
  (sc.choices || []).forEach((ch, i) => visitOutcome(ch, `${ctx}#${i}`));
  const free = (sc.choices || []).filter((ch) => !ch.req && !ch.if);
  if (!free.length) warns.push(`${ctx}: 항상 열려 있는 선택지가 없음 (동적으로 확인 필요)`);
  if (['event', 'fight'].includes(sc.kind) && !sc.acts) errors.push(`${ctx}: 풀 장면인데 acts 없음`);
});
Object.entries(D.enemies).forEach(([id, E]) => {
  (E.stances || []).forEach((st) => { if (!D.stances[st]) errors.push(`enemy ${id}: 없는 태세 ${st}`); });
  ((E.loot && E.loot.items) || []).forEach(([iid]) => { if (!D.items[iid]) errors.push(`enemy ${id}: 없는 전리품 ${iid}`); });
  (E.special || []).forEach((sp, j) => visitOutcome(sp, `enemy ${id}.special${j}`));
});
Object.entries(D.acts).forEach(([n, A]) => {
  A.script.forEach((s, i) => { if (typeof s === 'string' && !D.scenes[s]) errors.push(`act ${n} step ${i}: 없는 장면 ${s}`); if (typeof s === 'function') noteRead(s, `act ${n}`); });
  ['market', 'clinic', 'rest', 'ambush'].forEach((k) => { if (A[k] && !D.scenes[A[k]]) errors.push(`act ${n}: 없는 ${k} 장면 ${A[k]}`); });
  const pts = NR.MAP && NR.MAP.nodes[n];
  if (!pts || pts.length !== A.script.length) errors.push(`act ${n}: 지도 지점 ${pts ? pts.length : 0}개 ≠ 구역 ${A.script.length}개`);
  if (+n > 0) {
    const ev = Object.values(D.scenes).filter((sc) => sc.kind === 'event' && (sc.acts === 'any' || arr(sc.acts).includes(+n)));
    const fi = Object.values(D.scenes).filter((sc) => sc.kind === 'fight' && arr(sc.acts).includes(+n));
    console.log(`ACT ${n}: 사건 ${ev.length}개 (미확인 전용 ${ev.filter((x) => x.mysteryOnly).length}), 교전 ${fi.length}개, 비강제 구간 ${A.script.filter((x) => !x).length}칸`);
  }
});
['mt_hum', 'ct_quiet'].forEach((id) => { if (!D.scenes[id]) errors.push('fallback talk 없음: ' + id); });
flagsReq.forEach((ctx, f) => { if (!flagsSet.has(f)) errors.push(`${ctx}: 요구하는 플래그 "${f}"를 설정하는 곳이 없음`); });
flagsRead.forEach((ctx, f) => { if (!flagsSet.has(f) && !f.startsWith('dead_')) errors.push(`${ctx}: 읽는 플래그 "${f}"를 설정하는 곳이 없음`); });
const neverUsed = [...flagsSet].filter((f) => !flagsReq.has(f) && !flagsRead.has(f) && f !== '_pump');
console.log(`장면 ${Object.keys(D.scenes).length} · 적 ${Object.keys(D.enemies).length} · 결말 ${Object.keys(D.endings).length} · 데이터 파일 ${Object.keys(D.lore).length} · 기억 ${Object.keys(D.frags).length}`);
if (neverUsed.length) console.log('설정만 되고 읽히지 않는 플래그(정보용):', neverUsed.join(', '));
warns.forEach((w) => console.log('  경고 ·', w));
errors.forEach((e) => console.log('  오류 ·', e));
const textSize = Object.values(D.scenes).reduce((a, sc) => a + JSON.stringify(sc, (k, v) => (typeof v === 'function' ? v.toString() : v)).length, 0);
console.log(`장면 데이터 크기 약 ${(textSize / 1024).toFixed(0)}KB`);
if (errors.length) { console.log(`\n검증 실패: 오류 ${errors.length}건`); process.exitCode = 1; }
else console.log('\n정적 검증 통과');

/* =============================================================== 봇 */
const ENDV = { dawn: 120, uprising: 70, reunion: 65, liberation: 60, requiem: 35, deal: 10, throne: 5, captured: -60 };
const FLAGV = {
  docks_ally: 7, saints_ally: 7, wraiths_ally: 7, protest_ally: 7, rats_informants: 4, floodgate_intel: 3, kiki_saved: 4, kiki_ready: 3,
  seo_trust: 12, seo_free: 6, charon_spared: 10, charon_doubt: 6, charon_ally: 12, knows_charon: 5, bear_loyal: 5, cyan_loyal: 5, padre_loyal: 5,
  broadcast_backdoor: 5, spire_codes: 3, fake_badge: 2, evidence: 3, whale_promise: 2, vow: 2,
  charon_dead: -4, greed: -6, saints_enemy: -2, docks_betrayed: -4, sold_memory: -2, oh_dead: -2,
};
function fxValue(fx, r) {
  if (typeof fx === 'function') fx = fx(r);
  if (!fx) return 0;
  let v = 0;
  v += (fx.hp || 0) * (r.hp < r.maxhp * 0.45 ? 2 : 0.8);
  v += (fx.maxhp || 0) * 1.5;
  v += (fx.hum || 0) * (r.hum <= 4 ? 6 : 2);
  v += (fx.cred || 0) * 0.04;
  v += (fx.heat || 0) * -1.2;
  v += (fx.bond || 0) * 3;
  v += arr(fx.item).length * 3 - arr(fx.drop).length * 2;
  v += arr(fx.comp).length * 14 - arr(fx.leave).length * 14;
  arr(fx.flag).forEach((f) => { v += FLAGV[f] || 1; });
  v += arr(fx.frag).length * 7 + arr(fx.lore).length;
  if (fx.stat) Object.values(fx.stat).forEach((x) => { v += 7 * x; });
  return v;
}
function outValue(o, r) {
  if (!o) return 0;
  let v = fxValue(o.fx, r);
  if (o.fight) {
    const f = typeof o.fight === 'string' ? { e: o.fight } : o.fight;
    const E = D.enemies[f.e];
    v -= ((E.hp + (f.hpMod || 0)) * (E.atk[0] + E.atk[1]) / 2) * (r.hp < r.maxhp * 0.5 ? 0.9 : 0.45);
    if (f.win) v += outValue(f.win, r) * 0.8;
  }
  if (o.end) v += ENDV[typeof o.end === 'function' ? o.end(r) : o.end] || 0;
  if (o.go) {
    v += 2;
    const t = typeof o.go === 'string' && D.scenes[o.go];
    if (t && t.choices.length === 1 && t.choices[0].end) v += ENDV[t.choices[0].end] || 0;
  }
  if (o.shop) v += r.cred > 70 ? 4 : -2;
  return v;
}
const smart = {
  card(r) {
    let best = 0, bv = -1e9;
    r.cards.forEach((c, i) => {
      const hpR = r.hp / r.maxhp;
      let v = { event: 8, mystery: 8, story: 0, boss: 0, fight: hpR > 0.6 ? 3 : -6, rest: (1 - hpR) * 22 + r.heat * 1.2, clinic: hpR < 0.55 && r.cred >= 40 ? 16 : r.cred > 220 ? 7 : 0, market: r.cred >= 110 ? 7 : 1 }[c.type];
      v += Math.random() * 3;
      if (v > bv) { bv = v; best = i; }
    });
    return best;
  },
  choice(r, list) {
    const sc = D.scenes[r.scene];
    let best = list[0], bv = -1e9;
    list.forEach((c) => {
      const ch = sc.choices[c.i];
      let v = ch.check ? (c.chance / 100) * outValue(ch.ok, r) + (1 - c.chance / 100) * outValue(ch.no, r) : outValue(ch, r);
      if (ch.stay) v += 3;
      if (sc.kind === 'rest' && ch.go && r.bond < 9) v += 5;
      v += Math.random() * 2.5;
      if (v > bv) { bv = v; best = c; }
    });
    return best;
  },
  fightTurn(r) {
    const F = r.fight, E = D.enemies[F.e];
    const items = r.items;
    const hpR = r.hp / r.maxhp;
    if (hpR <= 0.35 && items.includes('nanoheal')) return ['item', 'nanoheal'];
    if (hpR <= 0.35 && items.includes('medkit')) return ['item', 'medkit'];
    if ((E.boss || hpR < 0.5) && E.mech && items.includes('emp')) return ['item', 'emp'];
    if ((E.boss || hpR < 0.5) && items.includes('grenade')) return ['item', 'grenade'];
    if (!E.boss && hpR <= 0.25 && items.includes('smoke')) return ['item', 'smoke'];
    const moves = C.fightMoves().filter((m) => !m.req || m.req.ok);
    const sp = moves.find((m) => m.special != null && (m.chance == null || m.chance >= 50));
    if (sp) return ['move', sp.id];
    let pickM = moves.filter((m) => m.id !== 'flee').sort((a, b) => b.chance - a.chance)[0];
    const flee = moves.find((m) => m.id === 'flee');
    if (flee && hpR <= 0.25 && flee.chance >= 55 && F.hp >= 2) pickM = flee;
    return ['move', pickM.id];
  },
  shop(r) {
    const sh = r.shop;
    if (sh.kind === 'market') {
      const medkits = r.items.filter((x) => x === 'medkit').length;
      sh.stock.forEach((id) => {
        const p = C.price(D.items[id].price);
        if (id === 'medkit' && medkits < 3 && r.cred >= p + 30) C.buy(id);
        else if (D.items[id].gear && r.cred >= p + 90) C.buy(id);
        else if (['grenade', 'emp', 'nanoheal'].includes(id) && r.cred >= p + 120) C.buy(id);
      });
    } else {
      if (r.hp < r.maxhp * 0.75) C.buy('full');
      if (r.hp < r.maxhp * 0.75) C.buy('patch');
      if (r.hum <= 6) C.buy('therapy');
      sh.stock.forEach((id) => { const W = D.ware[id]; if (r.cred >= C.price(W.price) + 60 && r.hum - W.hum >= 5) C.buy(id); });
    }
  },
  outside(r) {
    if (r.hp < r.maxhp * 0.4) { const k = r.items.indexOf('medkit'); if (k >= 0) C.useItem(k); }
    if (r.heat >= 7) { const k = r.items.indexOf('fakeid'); if (k >= 0) C.useItem(k); }
  },
};
/* 화면에 보이는 정보(선택지 문구·성공률·요구 조건)만 쓰는 봇. 결과 데이터는 보지 않는다. */
const casual = {
  card(r) {
    const hpR = r.hp / r.maxhp;
    let best = 0, bv = -1e9;
    r.cards.forEach((c, i) => {
      let v = { event: 6, mystery: 6, story: 0, boss: 0, fight: 3, rest: hpR < 0.5 ? 14 : 2, clinic: hpR < 0.5 && r.cred >= 40 ? 12 : 2, market: r.cred >= 100 ? 5 : 1 }[c.type];
      v += Math.random() * 6;
      if (v > bv) { bv = v; best = i; }
    });
    return best;
  },
  choice(r, list) {
    const sc = D.scenes[r.scene];
    let best = list[0], bv = -1e9;
    list.forEach((c) => {
      const ch = sc.choices[c.i];
      let v = Math.random() * 4;
      if (ch.req) v += 2;
      if (c.chance != null) v += (c.chance - 55) / 8;
      if (ch.stay) v += 1;
      if (sc.kind === 'rest') v += ch.go ? 2 : (r.hp < r.maxhp * 0.6 && ch.fx && ch.fx.hp >= 8 ? 4 : 0);
      if (v > bv) { bv = v; best = c; }
    });
    return best;
  },
  fightTurn: (r) => smart.fightTurn(r),
  shop: (r) => smart.shop(r),
  outside: (r) => smart.outside(r),
};
const random = {
  card: (r) => Math.floor(Math.random() * r.cards.length),
  choice: (r, list) => list[Math.floor(Math.random() * list.length)],
  fightTurn: () => { const ms = C.fightMoves().filter((m) => !m.req || m.req.ok); return ['move', ms[Math.floor(Math.random() * ms.length)].id]; },
  shop() {}, outside() {},
};

function playRun(policy, origin) {
  C.run = C.newRun('레인', origin);
  C.beginAct(0);
  const visited = new Set();
  for (let guard = 0; guard < 4000; guard++) {
    const r = C.run;
    /* 모든 상태에서 지도 렌더가 예외 없이 문자열을 만드는지 확인 */
    if (r.mode === 'end') { C.cityMapSVG('full', '마지막 위치'); return { ending: r.ending.id, act: r.act, steps: r.steps, run: r, visited }; }
    if (guard % 3 === 0) { C.mapBoxHTML(); C.mapSheetHTML(); }
    if (r.mode === 'act') { r.unlockMsg = null; C.prepareStep(true); continue; }
    if (r.mode === 'map') { policy.outside(r); C.chooseCard(policy.card(r)); continue; }
    if (r.mode === 'scene') {
      visited.add(r.scene);
      if (r.phase === 'choose') {
        const list = C.listChoices().filter((c) => c.req.ok);
        if (!list.length) throw new Error('선택 가능한 선택지 없음: ' + r.scene + ' flags=' + JSON.stringify(r.flags));
        C.choose(policy.choice(r, list).i);
      } else C.proceed();
      continue;
    }
    if (r.mode === 'fight') {
      if (r.fight.done) { C.fightProceed(); continue; }
      const [kind, x] = policy.fightTurn(r);
      if (kind === 'item') C.fightItem(x); else C.fightAct(x);
      continue;
    }
    if (r.mode === 'shop') { policy.shop(r); C.leaveShop(); continue; }
    throw new Error('알 수 없는 모드 ' + r.mode);
  }
  throw new Error('무한 루프 의심: ' + C.run.scene + ' mode=' + C.run.mode);
}

function freshMeta(unlockAll) {
  return { runs: 0, deaths: 0, echoes: 0, totalEchoes: 0, bestAct: 0, upgrades: {}, frags: {}, lore: {}, endings: {}, unlocked: unlockAll ? { corp: 1 } : {}, settings: { sound: false, motion: false } };
}
function simulate(name, policy, n) {
  const origins = Object.keys(D.origins);
  const ends = {}, deathAct = {}, byOrigin = {};
  const seen = new Set();
  let steps = 0, crashes = 0;
  for (let i = 0; i < n; i++) {
    C.meta = freshMeta(true);
    const origin = origins[i % origins.length];
    try {
      const res = playRun(policy, origin);
      ends[res.ending] = (ends[res.ending] || 0) + 1;
      if (D.endings[res.ending].type === 'death') deathAct[res.act] = (deathAct[res.act] || 0) + 1;
      byOrigin[origin] = byOrigin[origin] || { n: 0, fin: 0 };
      byOrigin[origin].n += 1; if (D.endings[res.ending].final) byOrigin[origin].fin += 1;
      steps += res.steps; res.visited.forEach((x) => seen.add(x));
    } catch (e) {
      crashes += 1;
      if (crashes <= 5) console.log(`  [${name}] 충돌:`, e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  const pct = (x) => (100 * x / n).toFixed(1) + '%';
  console.log(`\n== ${name} 봇 ${n}판 ==  충돌 ${crashes} · 평균 진행 ${(steps / n).toFixed(1)}구역`);
  console.log('  결말:', Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(' · '));
  console.log('  사망 시점:', Object.entries(deathAct).map(([k, v]) => `ACT${k} ${pct(v)}`).join(' · '));
  console.log('  출신별 완주율:', Object.entries(byOrigin).map(([k, v]) => `${k} ${(100 * v.fin / v.n).toFixed(0)}%`).join(' · '));
  return seen;
}

function campaign(runsPer, times) {
  const order = ['kit', 'stash', 'body', 'warmth', 'stealth', 'intuition', 'second'];
  const firstDawn = [], finalsBy = [], blockers = { bond: 0, seo: 0, charon: 0, n: 0 };
  for (let t = 0; t < times; t++) {
    C.meta = freshMeta(false);
    let dawnAt = null, firstFinal = null;
    for (let i = 0; i < runsPer; i++) {
      const M = C.meta;
      order.forEach((u) => { if (!M.upgrades[u] && M.echoes >= D.upgrades[u].cost) { M.echoes -= D.upgrades[u].cost; M.upgrades[u] = 1; } });
      const origins = Object.keys(D.origins).filter((o) => !D.origins[o].locked || M.unlocked[o]);
      const res = playRun(smart, origins[i % origins.length]);
      if (D.endings[res.ending].final && firstFinal == null) firstFinal = i + 1;
      if (NR.allFrags() && res.ending !== 'dawn' && D.endings[res.ending].final) {
        const f = res.run.flags; blockers.bond += res.run.bond < 8 ? 1 : 0; blockers.seo += f.seo_trust ? 0 : 1; blockers.charon += f.charon_ally ? 0 : 1; blockers.n += 1;
      }
      if (res.ending === 'dawn') { dawnAt = i + 1; break; }
    }
    firstDawn.push(dawnAt); finalsBy.push(firstFinal);
  }
  const ok = firstDawn.filter((x) => x != null);
  const fin = finalsBy.filter((x) => x != null);
  console.log(`\n== 캠페인 ${times}회 (최대 ${runsPer}판) ==`);
  console.log(`  첫 결말 도달: 평균 ${(fin.reduce((a, b) => a + b, 0) / Math.max(1, fin.length)).toFixed(1)}판째 (${fin.length}/${times}회 성공)`);
  console.log(`  진 결말 도달: ${ok.length}/${times}회 · 평균 ${(ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length)).toFixed(1)}판째`);
  console.log('  기억 파편 수집 현황(마지막 캠페인):', Object.keys(C.meta.frags).join(', '));
  if (blockers.n) console.log(`  기억을 다 모은 뒤 진 결말을 놓친 ${blockers.n}판의 원인 — 유대 부족 ${blockers.bond} · 서유진 신뢰 없음 ${blockers.seo} · 카론 동맹 없음 ${blockers.charon}`);
}

const simN = argVal('--sim', 0);
if (simN) {
  const s1 = simulate('무작위', random, simN);
  const s2 = simulate('전략', smart, simN);
  const s3 = simulate('일반(보이는 정보만)', casual, simN);
  const all = new Set([...s1, ...s2, ...s3]);
  const never = Object.keys(D.scenes).filter((id) => !all.has(id));
  console.log('\n한 번도 방문하지 않은 장면:', never.length ? never.join(', ') : '없음');
}
const campN = argVal('--campaign', 0);
if (campN) campaign(campN, 20);
