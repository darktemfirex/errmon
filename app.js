/* 화면: 데이터 로드 → Core.analyze → 섹션별 렌더링 */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('ko-KR');
  const TIER = {
    critical: { label: '즉시 조치', cls: 't-critical' },
    warn: { label: '조치 검토', cls: 't-warn' },
    watch: { label: '관찰', cls: 't-watch' }
  };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  const state = { data: null, A: null, tier: 'all', q: '', unit: 'day', target: '__all', open: new Set(), source: '', builtin: null };

  function msg(text, kind) {
    const el = $('#msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '') + (text ? '' : ' hide');
  }

  /* ---------- 공통 조각 ---------- */
  const chip = b => '<span class="chip ' + b.level + '">' + esc(b.text) + '</span>';

  function miniBars(values, w, h) {
    w = w || 104; h = h || 26;
    const max = Math.max(1, Math.max.apply(null, values));
    const n = values.length, bw = w / n;
    let s = '<svg class="mini-bars" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    values.forEach((v, i) => {
      const bh = v ? Math.max(2, v / max * (h - 2)) : 0;
      s += '<rect' + (i === n - 1 ? ' class="last"' : '') + ' x="' + (i * bw + 0.5) + '" y="' + (h - bh) + '" width="' + Math.max(1, bw - 1.5) + '" height="' + bh + '" rx="1"/>';
    });
    return s + '</svg>';
  }

  function niceMax(v) {
    v = Math.max(4, v);
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : m <= 8 ? 8 : 10) * p;
  }
  const shortLabel = l => (/^\d{4}-\d{2}-\d{2}$/.test(l) ? l.slice(5) : l);

  function colChart(labels, values, o) {
    o = o || {};
    const W = o.w || 960, H = o.h || 260, pl = 34, pr = 8, pt = 12, pb = 28;
    const n = values.length;
    const max = niceMax(Math.max.apply(null, values.concat([1])));
    const iw = W - pl - pr, ih = H - pt - pb, bw = iw / n;
    const x = i => pl + i * bw, y = v => pt + ih - (v / max) * ih;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || '차트') + '">';
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4;
      s += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + (Number.isInteger(v) ? v : v.toFixed(1)) + '</text>';
    }
    const step = o.labelStep || Math.max(1, Math.ceil(n / (o.maxLabels || 14)));
    values.forEach((v, i) => {
      const bwid = Math.max(1, bw * 0.78), bx = x(i) + (bw - bwid) / 2, by = y(v), bh = pt + ih - by;
      s += '<g><rect class="hit" x="' + x(i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '"/>' +
        '<rect class="bar' + (o.hi && o.hi.has(i) ? ' hi' : '') + '" x="' + bx + '" y="' + by + '" width="' + bwid + '" height="' + Math.max(0, bh) + '" rx="1.5"/>' +
        '<title>' + esc(labels[i]) + ': ' + (Number.isInteger(v) ? v : v.toFixed(1)) + '건</title></g>';
      if (i % step === 0) s += '<text class="axis" x="' + (x(i) + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(shortLabel(labels[i])) + '</text>';
    });
    if (o.ma) {
      s += '<polyline class="ma" points="' + o.ma.map((v, i) => (x(i) + bw / 2).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '"/>';
    }
    return s + '</svg>';
  }

  function spikeSet(values, minN) {
    const n = values.length || 1;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
    const thr = Math.max(minN, mean + 2 * sd);
    const set = new Set();
    values.forEach((v, i) => { if (v >= thr) set.add(i); });
    return { set, thr };
  }

  /* ---------- 섹션: KPI ---------- */
  function renderKpi() {
    const A = state.A, k = A.kpi;
    let delta = '직전 14일 데이터 없음', dcls = '';
    if (k.prev14 > 0) {
      const pct = Math.round((k.last14 - k.prev14) / k.prev14 * 100);
      delta = '직전 14일 ' + num(k.prev14) + '건 대비 <b class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : '') + pct + '%</b>';
      dcls = pct > 0 ? 'warn' : '';
    }
    $('#sec-kpi').innerHTML =
      '<div class="kpi"><div class="l">전체 오류</div><div class="v">' + num(k.total) + '건</div><div class="s">' + k.groupCount + '개 거래 · 고유 거래 ' + num(k.unique) + '건</div></div>' +
      '<div class="kpi danger"><div class="l">즉시 조치</div><div class="v">' + k.critical + '개</div><div class="s">꼭 처리해야 할 거래</div></div>' +
      '<div class="kpi warn"><div class="l">조치 검토</div><div class="v">' + k.warn + '개</div><div class="s">다음 순서로 확인 · 관찰 ' + k.watch + '개</div></div>' +
      '<div class="kpi ' + dcls + '"><div class="l">최근 14일 (~' + k.to.slice(5) + ')</div><div class="v">' + num(k.last14) + '건</div><div class="s">' + delta + '</div></div>';
  }

  /* ---------- 상세(카드·표 공용) ---------- */
  function detailHtml(g) {
    const p = g.parts, W = state.A.cfg.weights;
    const qs = g.queries.slice(0, 6).map(q => '<li><code>' + esc(q.label) + '</code> · <b>' + q.n + '건</b></li>').join('');
    const tbs = g.tables.length ? g.tables.map(t => '<code>' + esc(t.name) + '</code>').join(' ') : '<small>스택트레이스에 SQL이 없어 확인되지 않음</small>';
    const ev = g.events.map(e =>
      '<tr><td>' + esc(e.d + ' ' + e.t) + '</td><td>' + esc(e.n) + '</td><td>' + esc(e.c) + '</td><td>' + esc(e.ip) + '</td><td>' +
      (e.to ? e.to / 1000 + '초' : '') + '</td><td class="w"><code>' + esc(e.ql) + '</code></td></tr>').join('');
    return '<div class="detail">' +
      '<div><h3>점수 구성 (' + g.score + '점)</h3>최근 30일 ' + Math.round(p.recent) + '/' + W.recent + ' · 발생 일수 ' + Math.round(p.days) + '/' + W.days +
      ' · 월 지속 ' + Math.round(p.months) + '/' + W.months + ' · 사용자 ' + Math.round(p.users) + '/' + W.users + ' · 급증 ' + Math.round(p.trend) + '/' + W.trend + '</div>' +
      '<div><h3>쿼리별 발생</h3><ul>' + qs + '</ul></div>' +
      '<div><h3>대상 테이블</h3>' + tbs + '</div>' +
      '<div><h3>서버·제한시간</h3>' + g.nodes.map(n => esc(n.name) + ' ' + n.n + '건').join(' · ') +
      ' &nbsp;|&nbsp; 제한시간 ' + g.timeouts.map(t => t.ms / 1000 + '초 ' + t.n + '건').join(' · ') + '</div>' +
      '<div><h3>최근 발생 이력 (최대 10건)</h3><div class="scroll"><table class="mini"><thead><tr><th>일시</th><th>서버</th><th>컨테이너</th><th>사용자 IP</th><th>제한시간</th><th>쿼리</th></tr></thead><tbody>' + ev + '</tbody></table></div></div>' +
      (g.sql ? '<details><summary>SQL 샘플 (가장 많이 발생한 쿼리)</summary><pre>' + esc(g.sql) + '</pre></details>' : '') +
      '</div>';
  }

  /* ---------- 섹션: 꼭 조치해야 할 내역 ---------- */
  function cardHtml(g) {
    const t = TIER[g.tier], open = state.open.has(g.trx);
    const q = g.queries[0];
    const weekly = C.aggregate(state.A.dayKeys, g.series, 'week').values.slice(-13);
    return '<article class="card ' + t.cls + '">' +
      '<div class="card-h"><span class="rank">' + g.rank + '</span>' +
      '<div class="ttl"><b>' + esc(g.title) + (g.scr && g.op ? ' · ' + esc(g.op) : '') + '</b><small>' + esc(g.trx) + ' · ' + g.kind + '</small></div>' +
      '<div class="score" title="우선순위 점수 (100점 만점)"><b>' + g.score + '</b><small>점</small></div></div>' +
      '<div class="chips">' + g.badges.slice(0, 5).map(chip).join('') + '</div>' +
      '<dl class="facts"><div><dt>최근 14일</dt><dd>' + g.r14 + '건</dd></div><div><dt>전체</dt><dd>' + g.n + '건</dd></div>' +
      '<div><dt>발생 일수</dt><dd>' + g.days + '일</dd></div><div><dt>사용자</dt><dd>' + g.users + '명</dd></div></dl>' +
      '<div class="suspect"><span>의심 쿼리</span>' + (q ? '<code>' + esc(q.label) + '</code> <small>(' + q.n + '건)</small>' : '-') + '</div>' +
      '<ul class="todo">' + g.actions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' +
      '<div class="card-f"><button class="link" type="button" data-act="toggle" data-trx="' + esc(g.trx) + '">' + (open ? '접기' : '발생 이력·SQL 보기') + '</button>' +
      '<span title="최근 13주 주간 건수">' + miniBars(weekly) + '</span></div>' +
      (open ? detailHtml(g) : '') + '</article>';
  }

  function renderMust() {
    const A = state.A;
    const crit = A.groups.filter(g => g.tier === 'critical');
    let body;
    if (crit.length) body = '<div class="cards">' + crit.map(cardHtml).join('') + '</div>';
    else {
      const next = A.groups.filter(g => g.tier === 'warn').slice(0, 4);
      body = '<div class="empty">즉시 조치 대상이 없습니다.' + (next.length ? ' 아래 “조치 검토” 거래를 확인하세요.' : '') + '</div>' +
        (next.length ? '<div class="cards" style="margin-top:12px">' + next.map(cardHtml).join('') + '</div>' : '');
    }
    $('#sec-must').innerHTML =
      '<div class="sec-h"><h2>꼭 조치해야 할 내역</h2><p>점수 ' + A.cfg.critical + '점 이상, 또는 심각한 오라클 오류가 나온 거래만 모았습니다.</p></div>' + body;
  }

  /* ---------- 섹션: 전체 우선순위 표 ---------- */
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.A.groups.filter(g => {
      if (state.tier !== 'all' && g.tier !== state.tier) return false;
      if (!q) return true;
      const hay = [g.trx, g.scr, g.short].concat(g.queries.map(x => x.label), g.tables.map(t => t.name)).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderTableShell() {
    const k = state.A.kpi;
    const tab = (id, label, n) => '<button class="tab" type="button" data-act="tier" data-tier="' + id + '" aria-pressed="' + (state.tier === id) + '">' + label + ' ' + n + '</button>';
    $('#sec-table').innerHTML =
      '<div class="sec-h"><h2>전체 우선순위</h2><p>행을 누르면 쿼리·발생 이력·SQL이 펼쳐집니다.</p></div>' +
      '<div class="panel"><div class="tools"><div class="tabs">' +
      tab('all', '전체', k.groupCount) + tab('critical', '즉시 조치', k.critical) + tab('warn', '조치 검토', k.warn) + tab('watch', '관찰', k.watch) +
      '</div><input id="q" type="search" placeholder="화면ID·거래코드·쿼리·테이블 검색" value="' + esc(state.q) + '" aria-label="검색"></div>' +
      '<div class="scroll" id="tbl-wrap"></div></div>';
    renderTableBody();
  }

  function renderTableBody() {
    const list = filtered();
    if (!list.length) { $('#tbl-wrap').innerHTML = '<div class="none">조건에 맞는 항목이 없습니다.</div>'; return; }
    const rows = list.map(g => {
      const t = TIER[g.tier], open = state.open.has(g.trx);
      const d = g.r14 > g.p14 ? '<span class="up">▲' + g.p14 + '</span>' : g.r14 < g.p14 ? '<span class="down">▼' + g.p14 + '</span>' : '<small>-</small>';
      const q = g.queries[0];
      const weekly = C.aggregate(state.A.dayKeys, g.series, 'week').values.slice(-13);
      return '<tr class="row" tabindex="0" data-act="toggle" data-trx="' + esc(g.trx) + '" aria-expanded="' + open + '">' +
        '<td class="num">' + g.rank + '</td>' +
        '<td><span class="badge ' + t.cls + '">' + t.label + '</span></td>' +
        '<td><b>' + esc(g.title) + (g.scr && g.op ? ' · ' + esc(g.op) : '') + '</b><br><small>' + esc(g.trx) + (g.scr ? '' : ' · 연계') + '</small></td>' +
        '<td><div class="sbar ' + t.cls + '"><i style="width:' + Math.round(g.score * 0.6) + 'px"></i><b>' + g.score + '</b></div></td>' +
        '<td class="num">' + g.n + '</td>' +
        '<td class="num">' + g.r14 + ' ' + d + '</td>' +
        '<td class="num">' + g.days + '</td>' +
        '<td class="num">' + g.users + '</td>' +
        '<td class="q">' + (q ? '<code title="' + esc(q.label) + '">' + esc(q.label) + '</code>' : '-') + '</td>' +
        '<td>' + miniBars(weekly) + '</td></tr>' +
        (open ? '<tr class="dtl"><td colspan="10">' + detailHtml(g) + '</td></tr>' : '');
    }).join('');
    $('#tbl-wrap').innerHTML =
      '<table class="tbl"><thead><tr><th class="num">순위</th><th>등급</th><th>화면 / 거래</th><th>점수</th><th class="num">전체</th>' +
      '<th class="num" title="최근 14일 건수 (▲▼ 는 직전 14일 건수)">최근 14일</th><th class="num">발생 일수</th><th class="num">사용자</th><th>의심 쿼리(최다)</th><th title="최근 13주 주간 건수">주간 추이</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- 섹션: 일자별 추이 ---------- */
  function targetSeries() {
    const A = state.A;
    if (state.target === '__all') return { name: '전체', series: A.total };
    if (state.target === '__crit') {
      const s = new Array(A.total.length).fill(0);
      A.groups.filter(g => g.tier === 'critical').forEach(g => g.series.forEach((v, i) => { s[i] += v; }));
      return { name: '즉시 조치 거래 합계', series: s };
    }
    const g = A.groups.find(x => x.trx === state.target);
    return g ? { name: g.short, series: g.series } : { name: '전체', series: A.total };
  }

  function hbars(list, limit) {
    const max = Math.max.apply(null, list.map(x => x.n).concat([1]));
    return list.slice(0, limit || 8).map(x =>
      '<div class="hbar"><span class="nm" title="' + esc(x.name) + '">' + esc(x.name) + '</span><span class="t"><i style="width:' + (x.n / max * 100) + '%"></i></span><b>' + x.n + '</b></div>').join('');
  }

  function renderTrend() {
    const A = state.A;
    const ts = targetSeries();
    const agg = C.aggregate(A.dayKeys, ts.series, state.unit);
    const daily = state.unit === 'day';
    let sp = null;
    if (daily) sp = spikeSet(ts.series, state.target === '__all' ? 5 : 3);
    const sum = ts.series.reduce((a, b) => a + b, 0);
    const opts = state.A.groups.slice(0, 20).map(g => '<option value="' + esc(g.trx) + '"' + (state.target === g.trx ? ' selected' : '') + '>' + esc(g.short) + ' (' + g.n + '건)</option>').join('');
    const unitBtn = (u, l) => '<button type="button" data-act="unit" data-unit="' + u + '" aria-pressed="' + (state.unit === u) + '">' + l + '</button>';
    const spikeTxt = daily && sp.set.size
      ? '<p class="sub" style="margin-top:8px">급증일(평균+2σ 이상): ' + Array.from(sp.set).map(i => '<b>' + A.dayKeys[i].slice(5) + '</b> ' + ts.series[i] + '건').join(' · ') + '</p>' : '';

    // 상위 거래 주간 히트맵
    const top = A.groups.slice(0, 10);
    const wk = C.aggregate(A.dayKeys, A.total, 'week');
    const rowsW = top.map(g => ({ g, v: C.aggregate(A.dayKeys, g.series, 'week').values }));
    const maxCell = Math.max.apply(null, rowsW.map(r => Math.max.apply(null, r.v)).concat([1]));
    const heat = '<table class="heat"><thead><tr><th class="rl">거래</th>' + wk.labels.map(l => '<th>' + esc(l) + '</th>').join('') + '</tr></thead><tbody>' +
      rowsW.map(r => '<tr><th class="rl" title="' + esc(r.g.trx) + '">' + esc(r.g.short) + '</th>' + r.v.map(v =>
        '<td style="' + (v ? 'background:rgba(209,43,32,' + (0.12 + 0.78 * v / maxCell).toFixed(2) + ');' + (v / maxCell > 0.55 ? 'color:#fff' : '') : '') + '" title="' + esc(r.g.short) + ' ' + v + '건">' + (v || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table>';

    const monthly = '<table class="tbl"><thead><tr><th>월</th><th class="num">건수</th><th class="num">발생 일수</th><th class="num">일평균</th><th class="num">전월 대비</th><th>상위 3개 거래</th></tr></thead><tbody>' +
      A.monthly.map((m, i) => {
        const prev = A.monthly[i - 1];
        const avg = m.n / m.calDays;
        const prevAvg = prev ? prev.n / prev.calDays : 0;
        const pct = prev && prevAvg ? Math.round((avg - prevAvg) / prevAvg * 100) : null;
        return '<tr><td><b>' + esc(m.month) + '</b></td><td class="num">' + num(m.n) + '</td><td class="num">' + m.days + '/' + m.calDays + '</td><td class="num">' + avg.toFixed(1) + '</td>' +
          '<td class="num">' + (pct == null ? '-' : '<span class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : '') + pct + '%</span>') + '</td>' +
          '<td>' + m.top.map(t => esc(t.label) + ' <small>' + t.n + '건</small>').join(' · ') + '</td></tr>';
      }).join('') + '</tbody></table>';

    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    // 차트는 화면 폭에 맞춰 그려서 좁은 화면에서도 글자 크기가 유지되게 한다
    const cw = Math.max(300, Math.min(1200, ($('#sec-trend').clientWidth || 960) - 30));
    const mainH = cw < 600 ? 230 : 260;
    const smallW = window.innerWidth > 900 ? 420 : cw - 6;
    $('#sec-trend').innerHTML =
      '<div class="sec-h"><h2>일자별 오류 발생 추이</h2><p>' + esc(ts.name) + ' · 합계 ' + num(sum) + '건 · 일평균 ' + (sum / A.dayKeys.length).toFixed(1) + '건</p></div>' +
      '<div class="panel"><div class="tools"><div class="seg" role="group" aria-label="집계 단위">' + unitBtn('day', '일별') + unitBtn('week', '주별') + unitBtn('month', '월별') + '</div>' +
      '<select id="target" aria-label="대상 거래"><option value="__all"' + (state.target === '__all' ? ' selected' : '') + '>전체</option>' +
      '<option value="__crit"' + (state.target === '__crit' ? ' selected' : '') + '>즉시 조치 거래 합계</option>' + opts + '</select></div>' +
      '<div class="chart-box">' + colChart(agg.labels, agg.values, { w: cw, h: mainH, maxLabels: cw < 600 ? 6 : 14, aria: ts.name + ' 오류 발생 추이', hi: sp && sp.set, ma: daily ? C.movingAvg(ts.series, 7) : null }) +
      '<div class="legend"><span><i style="background:var(--bar)"></i>건수</span>' + (daily ? '<span><i style="background:var(--bar-hi)"></i>급증일</span><span><i style="background:var(--ma)"></i>7일 이동평균</span>' : '') + '</div>' + spikeTxt + '</div></div>' +
      '<div class="grid3">' +
      '<div class="panel"><h3>시간대별 (전체)</h3>' + colChart(hours, A.hourly, { w: smallW, h: 190, labelStep: 3, aria: '시간대별 발생' }) + '</div>' +
      '<div class="panel"><h3>요일별 (전체)</h3>' + colChart(WD, A.weekday, { w: smallW, h: 190, labelStep: 1, aria: '요일별 발생' }) + '</div>' +
      '<div class="panel"><h3>서버(NODE)별</h3>' + hbars(A.nodes, 6) + '<h3 style="margin-top:14px">컨테이너별</h3>' + hbars(A.containers, 6) + '</div></div>' +
      '<div class="panel" style="margin-top:12px;padding:12px 14px"><h3>상위 10개 거래 · 주간 발생 건수 (진할수록 많음)</h3><div class="scroll">' + heat + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><div class="scroll">' + monthly + '</div></div>';
  }

  /* ---------- 섹션: 점수 계산 방식 ---------- */
  function renderMethod() {
    const c = state.A.cfg, W = c.weights;
    $('#sec-method').innerHTML =
      '<details class="panel method"><summary>점수는 이렇게 계산합니다 (거래 단위, 100점 만점)</summary>' +
      '<table class="tbl"><thead><tr><th>항목</th><th class="num">배점</th><th>만점 기준</th></tr></thead><tbody>' +
      '<tr><td>최근 30일 발생 건수</td><td class="num">' + W.recent + '</td><td>' + c.recentFull + '건 이상</td></tr>' +
      '<tr><td>발생 일수 (꾸준히 반복되는가)</td><td class="num">' + W.days + '</td><td>' + c.dayCap + '일 이상 (기간이 짧으면 자동 축소)</td></tr>' +
      '<tr><td>월 지속 (여러 달에 걸쳐 나오는가)</td><td class="num">' + W.months + '</td><td>데이터 기간의 모든 달에 발생</td></tr>' +
      '<tr><td>영향 사용자 (서로 다른 IP 수)</td><td class="num">' + W.users + '</td><td>' + c.usersFull + '명 이상</td></tr>' +
      '<tr><td>최근 14일 급증</td><td class="num">' + W.trend + '</td><td>직전 14일 대비 3배 이상 (최근 14일 3건 이상일 때만)</td></tr>' +
      '</tbody></table>' +
      '<p><b>등급</b> · ' + c.critical + '점 이상 <b>즉시 조치</b> · ' + c.warn + '점 이상 <b>조치 검토</b> · 그 밖은 <b>관찰</b></p>' +
      '<p><b>보정 규칙</b> · 최근 30일 발생이 없으면 관찰로 내림 · 최근 14일 5건 이상이면서 직전의 3배 이상이면 최소 조치 검토 · ' +
      'ORA-00600/07445/04031/01555/01652~01654/03113 이 나오면 점수와 무관하게 즉시 조치 · 일회성으로 하루에 몰린 건은 지속 항목 점수가 낮아 자연히 아래로 내려갑니다.</p>' +
      '<p>의심 쿼리·대상 테이블은 스택트레이스(Related dbio, MyBatis 메시지, SQL 원문)에서 자동 추출합니다. 같은 TRX_GUID의 연계 호출(LINK_SEQ 1·2)은 각 거래에 따로 집계됩니다.</p></details>' +
      '<p class="foot">' + esc(state.source) + ' · 점수 기준 변경은 core.js 의 DEFAULTS 에서 조정</p>';
  }

  /* ---------- 전체 렌더 ---------- */
  function setData(data, source) {
    state.data = data;
    state.source = source;
    state.A = C.analyze(data.rows, { sqls: data.sqls });
    state.A.groups.forEach((g, i) => { g.rank = i + 1; });
    state.open.clear(); state.tier = 'all'; state.q = ''; state.unit = 'day'; state.target = '__all';
    const k = state.A.kpi;
    $('#period').textContent = k.from + ' ~ ' + k.to + ' (' + k.span + '일) · ' + num(k.total) + '건 · ' +
      source + (data.files && data.files.length ? ' (' + data.files.join(', ') + ')' : '');
    renderKpi(); renderMust(); renderTableShell(); renderTrend(); renderMethod();
  }

  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    if (!state.A) return;
    const head = ['순위', '등급', '점수', '화면ID', '거래코드', '전체', '최근14일', '직전14일', '최근30일', '발생일수', '발생월수', '영향사용자(IP)', '의심쿼리', '대상테이블', '근거', '권장조치'];
    const lines = [head.join(',')].concat(state.A.groups.map(g => [
      g.rank, TIER[g.tier].label, g.score, g.scr, g.trx, g.n, g.r14, g.p14, g.r30, g.days, g.months, g.users,
      g.queries[0] ? g.queries[0].label : '', g.tables.map(t => t.name).join(' '),
      g.badges.map(b => b.text).join(' / '), g.actions.join(' / ')].map(csvCell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '오류_조치우선순위_' + state.A.kpi.to.replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    try {
      msg('엑셀을 읽는 중…');
      let records = [];
      for (const f of files) {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        for (const name of wb.SheetNames) {
          records = records.concat(C.recordsFromAoa(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false })));
        }
      }
      const ds = C.buildDataset(records);
      if (!ds.rows.length) { msg('읽을 수 있는 오류 행이 없습니다. TRX_CD, LOG_OCCUR_DTTM 컬럼이 있는 시트인지 확인해 주세요.', 'err'); return; }
      ds.files = files.map(f => f.name);
      setData(ds, '업로드');
      msg(files.length + '개 파일에서 ' + num(ds.rows.length) + '건을 불러왔습니다. (새로고침하면 내장 데이터로 돌아갑니다)');
    } catch (e) {
      msg('엑셀을 읽지 못했습니다: ' + e.message, 'err');
    }
  }

  /* ---------- 이벤트 ---------- */
  function toggle(trx) {
    if (state.open.has(trx)) state.open.delete(trx); else state.open.add(trx);
    renderMust(); renderTableBody();
  }
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el || !state.A) return;
    const act = el.dataset.act;
    if (act === 'toggle') toggle(el.dataset.trx);
    else if (act === 'tier') { state.tier = el.dataset.tier; renderTableShell(); }
    else if (act === 'unit') { state.unit = el.dataset.unit; renderTrend(); }
  });
  document.addEventListener('keydown', ev => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('tr.row')) { ev.preventDefault(); toggle(ev.target.dataset.trx); }
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'q') { state.q = ev.target.value; renderTableBody(); }
  });
  document.addEventListener('change', ev => {
    if (ev.target.id === 'target') { state.target = ev.target.value; renderTrend(); }
  });
  let lastW = window.innerWidth, rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (state.A && Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; renderTrend(); }
    }, 150);
  });
  $('#file').addEventListener('change', ev => { handleFiles(ev.target.files).then(() => { ev.target.value = ''; }); });
  $('#csv').addEventListener('click', exportCsv);
  $('#reset').addEventListener('click', () => { if (state.builtin) { setData(state.builtin, '내장 데이터'); msg(''); } else loadBuiltin(); });

  /* ---------- 시작 ---------- */
  function loadBuiltin() {
    fetch('data.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { state.builtin = d; setData(d, '내장 데이터'); msg(''); })
      .catch(e => {
        $('#period').textContent = '분석할 데이터가 없습니다. 오른쪽 위 “엑셀 불러오기”로 오류 로그 엑셀을 선택해 주세요.';
        msg('내장 데이터가 없습니다(' + e.message + '). 엑셀은 이 브라우저 안에서만 분석되고 서버로 전송되지 않습니다.', 'info');
      });
  }
  loadBuiltin();
})();
