/* 오류 로그 분석 코어: 엑셀 행 파싱 + 우선순위 점수 계산. 브라우저/Node 공용(UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const str = v => (v == null ? '' : String(v));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const fmtDate = ms => {
    const x = new Date(ms);
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  };

  /** 점수·등급 기준 (화면의 "점수 계산 방식"에도 그대로 표시됨) */
  const DEFAULTS = {
    critical: 70, // 이 점수 이상 → 즉시 조치
    warn: 40,     // 이 점수 이상 → 조치 검토
    weights: { recent: 35, days: 25, months: 15, users: 10, trend: 15 },
    recentFull: 20,  // 최근 30일 이 건수면 '최근' 항목 만점
    usersFull: 10,   // 영향 IP 수가 이 값이면 '사용자' 항목 만점
    daysFullMax: 15  // 발생 일수 만점 상한(기간이 짧으면 자동 축소)
  };

  /** 이 코드가 나오면 점수와 무관하게 즉시 조치로 올리는 오라클 오류 */
  const CRITICAL_ORA = {
    'ORA-00600': '오라클 내부 오류',
    'ORA-07445': '오라클 프로세스 비정상 종료',
    'ORA-04031': '공유 메모리 부족',
    'ORA-01555': '언두 부족(Snapshot too old)',
    'ORA-01652': '임시 공간 부족',
    'ORA-01653': '테이블스페이스 공간 부족',
    'ORA-01654': '인덱스 공간 부족',
    'ORA-03113': '통신 채널 EOF(세션 끊김)'
  };

  const GENERIC_PROXY = new Set(['selectList', 'selectOne', 'selectMap', 'select', 'insert', 'update', 'delete',
    'commit', 'rollback', 'flushStatements', 'selectCursor', 'getConnection', 'close', 'clearCache']);

  function normDttm(v) {
    if (v instanceof Date) {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()) + ' ' +
        pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
    }
    return str(v).trim();
  }

  /** 엑셀 한 행(헤더명→값) → 분석용 행. 스택트레이스에서 쿼리·테이블·SQL을 뽑아낸다. */
  function extractRow(rec) {
    const dttm = normDttm(rec.LOG_OCCUR_DTTM);
    let d = /^\d{4}-\d{2}-\d{2}/.test(dttm) ? dttm.slice(0, 10) : '';
    const t = d ? dttm.slice(11, 19) : '';
    if (!d) {
      const x = str(rec.TRX_DT).trim();
      if (/^\d{8}$/.test(x)) d = x.slice(0, 4) + '-' + x.slice(4, 6) + '-' + x.slice(6, 8);
    }
    const trx = str(rec.TRX_CD).trim();
    if (!d || !trx) return null;

    const msg = str(rec.ERR_MSG_CTT);
    const st = str(rec.ERR_STACKTRACE);

    const tm = msg.match(/제한시간\[([\d,]+)\]/);
    const to = tm ? parseInt(tm[1].replace(/,/g, ''), 10) : 0;

    const oraM = (str(rec.SQL_ERR_CD) + ' ' + msg + ' ' + st).match(/ORA-\d{5}/);
    const ora = oraM ? oraM[0] : '';

    // 의심 쿼리: Related dbio → MyBatis "may involve" → 매퍼 프록시 메서드 → Biz 메서드 순으로 찾는다
    let db = (st.match(/Related dbio \[([^\]]+)\]/) || [])[1] || '';
    if (db === 'defaultParameterMap') db = '';
    if (!db) db = (st.match(/The error may involve ([\w.$-]+)/) || [])[1] || '';
    let mp = '';
    for (const m of st.matchAll(/\$Proxy\d+\.(\w+)\(Unknown Source\)/g)) {
      if (!GENERIC_PROXY.has(m[1])) { mp = m[1]; break; }
    }
    const bizM = st.match(/at wm\.\w+\.biz\.(\w+\.\w+)/);
    const biz = bizM ? bizM[1] : '';

    let q, ql;
    if (db) {
      const parts = db.split('.');
      const method = parts.pop().replace(/-Inline$/, '');
      const cls = parts.pop() || '';
      q = method;
      ql = cls ? cls + '.' + method : method;
    } else if (mp) { q = mp; ql = mp; }
    else if (biz) { q = biz; ql = biz; }
    else { q = ''; ql = '쿼리 미확인'; }

    const sm = st.match(/### SQL: ([\s\S]*?)(?:\r?\n### |$)/);
    const sql = sm ? sm[1].replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
    const tb = Array.from(new Set((sql.match(/\b(?:TB|VW)_[A-Z0-9_]+\b/gi) || []).map(s => s.toUpperCase()))).slice(0, 8);

    return {
      row: {
        d, t, trx,
        n: str(rec.NODE_NM).trim(),
        c: str(rec.CONTAINER_NM).trim(),
        scr: str(rec.SCREEN_ID).trim(),
        ip: str(rec.SEND_USER_IP).trim(),
        err: str(rec.ERR_CD).trim(),
        to, q, ql, tb, ora,
        lk: Number(rec.LINK_SEQ) || 0,
        g: str(rec.TRX_GUID).trim(),
        app: str(rec.BXM_APP_ID).trim()
      },
      sql
    };
  }

  /** 헤더 행을 찾아 [{헤더:값}] 로 변환 (맨 위에 제목 행이 있어도 됨) */
  function recordsFromAoa(aoa) {
    const hi = aoa.findIndex(r => Array.isArray(r) && r.map(str).map(s => s.trim()).includes('TRX_CD') &&
      r.map(str).map(s => s.trim()).includes('LOG_OCCUR_DTTM'));
    if (hi < 0) return [];
    const head = aoa[hi].map(s => str(s).trim());
    const out = [];
    for (let i = hi + 1; i < aoa.length; i++) {
      const r = aoa[i];
      if (!r || !r.some(v => v !== '' && v != null)) continue;
      const o = {};
      head.forEach((h, j) => { if (h) o[h] = r[j]; });
      out.push(o);
    }
    return out;
  }

  /** 레코드들 → {rows, sqls}. 같은 거래/시각/GUID 중복은 제거 */
  function buildDataset(records) {
    const seen = new Set();
    const rows = [];
    const sqls = {};
    for (const rec of records) {
      const x = extractRow(rec);
      if (!x) continue;
      const k = [x.row.g, x.row.lk, x.row.d, x.row.t, x.row.trx].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      if (x.sql) {
        const sk = x.row.trx + '|' + x.row.q;
        if (!sqls[sk]) sqls[sk] = x.sql;
      }
      rows.push(x.row);
    }
    rows.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
    return { rows, sqls };
  }

  function topEntries(obj, limit) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit || 99);
  }

  function weekStart(d) {
    const ms = toUTC(d);
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // 월=0
    return fmtDate(ms - dow * DAY);
  }

  /** 일별 배열을 일/주/월 단위로 합산 */
  function aggregate(dayKeys, series, unit) {
    if (unit === 'day') return { labels: dayKeys.slice(), values: series.slice() };
    const map = new Map();
    dayKeys.forEach((d, i) => {
      const k = unit === 'week' ? weekStart(d) : d.slice(0, 7);
      map.set(k, (map.get(k) || 0) + series[i]);
    });
    const labels = Array.from(map.keys());
    return { labels: unit === 'week' ? labels.map(l => l.slice(5)) : labels, values: Array.from(map.values()), keys: labels };
  }

  function movingAvg(series, w) {
    return series.map((_, i) => {
      const from = Math.max(0, i - w + 1);
      let s = 0;
      for (let j = from; j <= i; j++) s += series[j];
      return s / (i - from + 1);
    });
  }

  function suggest(g) {
    const out = [];
    const crit = Object.keys(g.ora).filter(c => CRITICAL_ORA[c]);
    if (crit.length) out.push(crit.map(c => c + ' ' + CRITICAL_ORA[c]).join(', ') + ' 발생 — DBA 확인 필요');
    const q = g.queries.find(x => x.label !== '쿼리 미확인');
    if (q) out.push(q.label + ' 쿼리의 실행계획(풀스캔·조인 순서·인덱스) 점검');
    else out.push('스택트레이스로 지연 쿼리를 식별한 뒤 실행계획 점검');
    if (g.tables.length) out.push('대상 테이블 ' + g.tables.slice(0, 3).map(t => t.name).join(', ') + ' 통계정보·인덱스 확인');
    out.push(g.kind === '화면'
      ? '조회조건 필수화·조회기간 제한·페이징 적용 검토'
      : '처리 건수 분할·실행 시간대 조정 검토');
    if (g.skewNode) out.push(g.skewNode + ' 서버에 편중 — 해당 서버 상태(DB 커넥션·부하) 점검');
    return out;
  }

  /** 핵심 분석: 거래별 점수·등급·근거, 일별 추이, 시간대/요일/서버 분포, 월별 비교 */
  function analyze(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return null;
    const cfg = Object.assign({}, DEFAULTS, opts.cfg || {});
    const W = Object.assign({}, DEFAULTS.weights, (opts.cfg && opts.cfg.weights) || {});
    const sqls = opts.sqls || {};

    let minD = rows[0].d, maxD = rows[0].d;
    for (const r of rows) { if (r.d < minD) minD = r.d; if (r.d > maxD) maxD = r.d; }
    const t0 = toUTC(minD), t1 = toUTC(maxD);
    const span = Math.round((t1 - t0) / DAY) + 1;
    const dayKeys = [];
    for (let i = 0; i < span; i++) dayKeys.push(fmtDate(t0 + i * DAY));
    const dayIdx = {};
    dayKeys.forEach((k, i) => { dayIdx[k] = i; });

    const months = Array.from(new Set(rows.map(r => r.d.slice(0, 7)))).sort();
    const M = months.length;
    const dayCap = clamp(Math.round(span * 0.2), 3, cfg.daysFullMax);

    const total = new Array(span).fill(0);
    const hourly = new Array(24).fill(0);
    const weekday = new Array(7).fill(0);
    const nodeC = {}, contC = {}, guids = new Set();
    const monthTrx = {};
    const byTrx = new Map();

    for (const r of rows) {
      const di = dayIdx[r.d];
      const ago = span - 1 - di;
      total[di]++;
      const h = parseInt(r.t.slice(0, 2), 10);
      if (h >= 0 && h < 24) hourly[h]++;
      weekday[new Date(toUTC(r.d)).getUTCDay()]++;
      const nk = r.n || '(미상)';
      nodeC[nk] = (nodeC[nk] || 0) + 1;
      const ck = r.c || '(미상)';
      contC[ck] = (contC[ck] || 0) + 1;
      guids.add(r.g || (r.d + r.t + r.trx));

      const mk = r.d.slice(0, 7);
      (monthTrx[mk] = monthTrx[mk] || {})[r.trx] = ((monthTrx[mk] || {})[r.trx] || 0) + 1;

      let g = byTrx.get(r.trx);
      if (!g) {
        g = {
          trx: r.trx, scr: r.scr, n: 0, daySet: new Set(), monthSet: new Set(), ipSet: new Set(),
          r14: 0, p14: 0, r30: 0, nodes: {}, to: {}, errs: {}, q: {}, tb: {}, ora: {},
          series: new Array(span).fill(0), rows: [], first: r.d, last: r.d
        };
        byTrx.set(r.trx, g);
      }
      if (!g.scr && r.scr) g.scr = r.scr;
      g.n++;
      g.series[di]++;
      g.daySet.add(r.d);
      g.monthSet.add(mk);
      if (r.ip) g.ipSet.add(r.ip);
      if (ago < 14) g.r14++; else if (ago < 28) g.p14++;
      if (ago < 30) g.r30++;
      if (r.d < g.first) g.first = r.d;
      if (r.d > g.last) g.last = r.d;
      g.nodes[nk] = (g.nodes[nk] || 0) + 1;
      if (r.to) g.to[r.to] = (g.to[r.to] || 0) + 1;
      if (r.err) g.errs[r.err] = (g.errs[r.err] || 0) + 1;
      const qe = g.q[r.q || '_'] || (g.q[r.q || '_'] = { key: r.q, label: r.ql, n: 0 });
      qe.n++;
      if (r.ql.indexOf('.') > 0 && qe.label.indexOf('.') < 0) qe.label = r.ql;
      r.tb.forEach(t => { g.tb[t] = (g.tb[t] || 0) + 1; });
      if (r.ora) g.ora[r.ora] = (g.ora[r.ora] || 0) + 1;
      g.rows.push(r);
    }

    const groups = [];
    for (const g of byTrx.values()) {
      const days = g.daySet.size, months_ = g.monthSet.size, users = g.ipSet.size;
      const parts = {
        recent: W.recent * Math.min(g.r30 / cfg.recentFull, 1),
        days: W.days * Math.min(days / dayCap, 1),
        months: M > 1 ? W.months * clamp((months_ - 1) / (M - 1), 0, 1) : 0,
        users: W.users * Math.min(users / cfg.usersFull, 1),
        trend: g.r14 >= 3 ? W.trend * clamp(((g.r14 + 1) / (g.p14 + 1) - 1) / 2, 0, 1) : 0
      };
      const score = Math.round(parts.recent + parts.days + parts.months + parts.users + parts.trend);

      const nodes = topEntries(g.nodes).map(([name, n]) => ({ name, n }));
      const nodeTotal = g.n;
      const topNode = nodes[0];
      const skewNode = topNode && nodes.length >= 1 && g.n >= 8 && topNode.n / nodeTotal >= 0.75 && Object.keys(nodeC).length >= 2
        ? topNode.name : '';
      const queries = Object.values(g.q).sort((a, b) => b.n - a.n);
      const tables = topEntries(g.tb, 6).map(([name, n]) => ({ name, n }));
      const timeouts = topEntries(g.to).map(([ms, n]) => ({ ms: +ms, n }));
      const toTop = timeouts[0] ? timeouts[0].ms : 0;
      const kind = g.scr ? '화면' : '연계';
      const oraCrit = Object.keys(g.ora).filter(c => CRITICAL_ORA[c]);

      // 등급 결정
      let tier = score >= cfg.critical ? 'critical' : score >= cfg.warn ? 'warn' : 'watch';
      const ratio = (g.r14 + 1) / (g.p14 + 1);
      const spike = g.r14 >= 5 && ratio >= 3;
      const cooling = g.p14 >= 5 && g.r14 * 3 <= g.p14;
      const stale = g.r30 === 0;
      if (Object.keys(g.ora).length && tier === 'watch') tier = 'warn';
      if (oraCrit.length) tier = 'critical';
      if (spike && tier === 'watch') tier = 'warn';
      if (stale && !oraCrit.length) tier = 'watch';

      // 근거 칩
      const badges = [];
      const add = (level, text) => badges.push({ level, text });
      oraCrit.forEach(c => add('danger', c + ' ' + CRITICAL_ORA[c]));
      if (spike) add('danger', '최근 14일 급증 (' + g.p14 + '→' + g.r14 + '건)');
      if (M >= 2 && months_ === M) add('warn', M + '개월 연속 발생');
      if (days >= 10) add('warn', days + '일 발생');
      if (users >= 5) add('warn', '영향 사용자(IP) ' + users + '명');
      if (skewNode) add('info', skewNode + ' 서버 편중 ' + Math.round(topNode.n / nodeTotal * 100) + '%');
      else if (g.n >= 8 && nodes.length >= 3) add('info', '전 서버 공통 발생 (쿼리·데이터 원인 가능성)');
      const maxDayN = Math.max.apply(null, g.series);
      if (days <= 2 && g.n >= 8) add('info', '특정일 집중 (' + maxDayN + '건/일)');
      if (toTop >= 180000) add('info', '제한시간 ' + toTop / 1000 + '초 거래');
      if (cooling) add('ok', '최근 14일 감소 (' + g.p14 + '→' + g.r14 + '건)');
      if (stale) add('ok', '최근 30일 발생 없음');

      const op = (g.trx.match(/([A-Z]\d{2})$/) || [])[1] || '';
      const grp = {
        trx: g.trx, scr: g.scr, kind, op,
        title: g.scr ? '화면 ' + g.scr : g.trx,
        short: g.scr ? g.scr + (op ? '·' + op : '') : g.trx,
        n: g.n, days, months: months_, users, r14: g.r14, p14: g.p14, r30: g.r30,
        first: g.first, last: g.last, score, parts, tier, badges,
        queries, tables, nodes, timeouts, ora: g.ora, skewNode,
        errs: topEntries(g.errs).map(([code, n]) => ({ code, n })),
        series: g.series,
        events: g.rows.slice().sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t)).slice(0, 10)
      };
      grp.actions = suggest(grp);
      grp.sql = queries[0] ? (sqls[g.trx + '|' + queries[0].key] || '') : '';
      groups.push(grp);
    }
    groups.sort((a, b) => b.score - a.score || b.r30 - a.r30 || b.n - a.n);

    // 급증일: 평균 + 2표준편차 이상 (최소 5건)
    const mean = total.reduce((a, b) => a + b, 0) / span;
    const sd = Math.sqrt(total.reduce((a, b) => a + (b - mean) * (b - mean), 0) / span);
    const spikeThr = Math.max(5, mean + 2 * sd);
    const spikeDays = [];
    total.forEach((v, i) => { if (v >= spikeThr) spikeDays.push({ d: dayKeys[i], n: v, i }); });

    const sumRange = (from, to) => { let s = 0; for (let i = Math.max(0, from); i <= to; i++) s += total[i]; return s; };
    const last14 = sumRange(span - 14, span - 1);
    const prev14 = sumRange(span - 28, span - 15);

    let busiest = { d: dayKeys[0], n: total[0] };
    total.forEach((v, i) => { if (v > busiest.n) busiest = { d: dayKeys[i], n: v }; });

    const monthly = months.map((m, idx) => {
      const idxs = dayKeys.map((k, i) => (k.slice(0, 7) === m ? i : -1)).filter(i => i >= 0);
      const n = idxs.reduce((a, i) => a + total[i], 0);
      const top = topEntries(monthTrx[m], 3).map(([trx, c]) => {
        const g = groups.find(x => x.trx === trx);
        return { trx, label: g ? g.short : trx, n: c };
      });
      return { month: m, n, days: idxs.filter(i => total[i] > 0).length, calDays: idxs.length, top };
    });

    return {
      cfg: Object.assign({}, cfg, { weights: W, dayCap }),
      dayKeys, total, hourly, weekday,
      nodes: topEntries(nodeC).map(([name, n]) => ({ name, n })),
      containers: topEntries(contC).map(([name, n]) => ({ name, n })),
      groups, spikeDays, spikeThr, monthly, months,
      kpi: {
        total: rows.length, unique: guids.size, groupCount: groups.length,
        from: minD, to: maxD, span, last14, prev14, busiest,
        critical: groups.filter(g => g.tier === 'critical').length,
        warn: groups.filter(g => g.tier === 'warn').length,
        watch: groups.filter(g => g.tier === 'watch').length
      }
    };
  }

  return {
    DEFAULTS, CRITICAL_ORA, extractRow, recordsFromAoa, buildDataset, analyze,
    aggregate, movingAvg, fmtDate, toUTC
  };
});
