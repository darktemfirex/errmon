/* 실행: node --test  (errmon 폴더에서) */
const test = require('node:test');
const assert = require('node:assert');
const C = require('./core.js');

const mk = (o) => Object.assign({
  d: '2026-10-01', t: '10:00:00', trx: 'ORBWMEN700001R01', n: 'node1', c: 'c1', scr: '700001', u: 'u0',
  err: 'BXME30006', to: 30000, q: 'sel', ql: 'XDao.sel', tb: [], ora: '', lk: 0, g: '', app: ''
}, o);

function rowsFor(trx, dates, extra) {
  return dates.map((d, i) => mk(Object.assign({ trx, d, g: trx + d + i, u: 'u' + (i % 12) }, extra || {})));
}
function span(from, n) {
  const out = []; const t0 = C.toUTC(from);
  for (let i = 0; i < n; i++) out.push(C.fmtDate(t0 + i * 864e5));
  return out;
}

test('extractRow: 스택트레이스에서 쿼리·테이블·SQL 추출', () => {
  const st = 'org.mybatis.spring.MyBatisSystemException: x\r\n### Error querying database.\r\n' +
    '### The error may involve wm.en.dao.WMEN704035Dao.selectItem\r\n' +
    '### SQL: SELECT a FROM TB_NA_WM_DM_OUT t1 , tb_na_wm_eh_dc_img t2 WHERE 1=1\r\n### Cause: x\r\n\tat a.b';
  const { row, sql } = C.extractRow({
    LOG_OCCUR_DTTM: '2026-08-31 22:22:48.206', TRX_CD: 'ORBWMEN704035R01', SCREEN_ID: '704035', ERR_CD: 'BXME30006',
    ERR_MSG_CTT: '[물류센터] 요청하신 서비스 [wm.en.svc.WMEN704035Svc]의 오퍼레이션 [r01] 처리중 관리자가 지정한 제한시간[30,000]ms를 초과하였습니다.',
    ERR_STACKTRACE: st, SEND_USER_IP: '10.1.1.1', NODE_NM: 'n1', LINK_SEQ: '0', TRX_GUID: 'g1'
  });
  assert.equal(row.d, '2026-08-31');
  assert.equal(row.t, '22:22:48');
  assert.equal(row.to, 30000);
  assert.equal(row.q, 'selectItem');
  assert.equal(row.ql, 'WMEN704035Dao.selectItem');
  assert.deepEqual(row.tb, ['TB_NA_WM_DM_OUT', 'TB_NA_WM_EH_DC_IMG']);
  assert.match(sql, /^SELECT a FROM TB_NA_WM_DM_OUT/);
});

test('사용자 IP는 결과 어디에도 남지 않고, 같은 IP는 같은 토큰으로 사용자 수 계산이 된다', () => {
  let seq = 0;
  const rec = ip => ({ LOG_OCCUR_DTTM: '2026-10-01 10:00:00', TRX_CD: 'T1', SEND_USER_IP: ip, TRX_GUID: 'guid-' + (++seq) });
  const a = C.extractRow(rec('10.1.1.1')), a2 = C.extractRow(rec('10.1.1.1')), b = C.extractRow(rec('10.1.1.2'));
  assert.ok(!JSON.stringify(a).includes('10.1.1.1'), '원본 IP 가 남아 있음');
  assert.ok(!('ip' in a.row));
  assert.equal(a.row.u, a2.row.u);
  assert.notEqual(a.row.u, b.row.u);
  assert.equal(C.extractRow({ LOG_OCCUR_DTTM: '2026-10-01 10:00:00', TRX_CD: 'T1' }).row.u, '');
  const A = C.analyze(C.buildDataset([rec('10.1.1.1'), rec('10.1.1.1'), rec('10.1.1.2')].map((r, i) => Object.assign(r, { TRX_GUID: 'x' + i }))).rows);
  assert.equal(A.groups[0].users, 2);
});

test('extractRow: defaultParameterMap 이면 프록시 매퍼 메서드·Biz 로 대체', () => {
  const st = 'bxm.instance.ServiceOperationTimedOutException: x\r\n Related dbio [defaultParameterMap].\r\n' +
    '\tat com.sun.proxy.$Proxy60.selectList(Unknown Source)\r\n\tat com.sun.proxy.$Proxy522.selectTrtWrsInfList2(Unknown Source)\r\n' +
    '\tat wm.mn.biz.WMMN701002Biz.getTrtWrsInfList(WMMN701002Biz.java:278)';
  const { row } = C.extractRow({ LOG_OCCUR_DTTM: '2026-08-31 22:22:48.206', TRX_CD: 'T1', ERR_STACKTRACE: st });
  assert.equal(row.q, 'selectTrtWrsInfList2');
});

test('extractRow: ORA 코드 인식, 날짜 없으면 TRX_DT 사용, 필수값 없으면 null', () => {
  const a = C.extractRow({ TRX_DT: '20261001', TRX_CD: 'T1', ERR_MSG_CTT: 'x ORA-01555: snapshot too old' });
  assert.equal(a.row.d, '2026-10-01');
  assert.equal(a.row.ora, 'ORA-01555');
  assert.equal(C.extractRow({ LOG_OCCUR_DTTM: '2026-10-01 10:00:00' }), null);
});

test('recordsFromAoa: 맨 위 제목 행이 있어도 헤더를 찾는다', () => {
  const aoa = [['제목', ''], ['', ''], ['순번', 'TRX_CD', 'LOG_OCCUR_DTTM'], [1, 'T1', '2026-10-01 10:00:00'], ['', '', '']];
  const recs = C.recordsFromAoa(aoa);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].TRX_CD, 'T1');
});

test('buildDataset: 중복 제거', () => {
  const rec = { LOG_OCCUR_DTTM: '2026-10-01 10:00:00', TRX_CD: 'T1', TRX_GUID: 'g', LINK_SEQ: 0 };
  assert.equal(C.buildDataset([rec, rec, Object.assign({}, rec, { TRX_CD: 'T2' })]).rows.length, 2);
});

test('우선순위: 꾸준히 반복되는 거래가 하루 몰린 거래보다 위, 최근 미발생은 관찰', () => {
  const days = span('2026-08-01', 92);
  // 꾸준: 3개월 걸쳐 2~3일에 한 번, 최근 30일에도 발생
  const steady = rowsFor('STEADY', days.filter((_, i) => i % 3 === 0).concat(days.slice(-20)));
  // 일회성: 8월 초 하루에 25건
  const burst = rowsFor('BURST', new Array(25).fill('2026-08-04'));
  // 옛날 반복: 8월 한 달만, 이후 없음
  const old = rowsFor('OLD', days.slice(0, 25));
  const A = C.analyze([].concat(steady, burst, old));
  const by = Object.fromEntries(A.groups.map(g => [g.trx, g]));
  assert.ok(by.STEADY.score > by.BURST.score, 'steady > burst');
  assert.equal(by.STEADY.tier, 'critical');
  assert.equal(by.BURST.tier, 'watch');
  assert.equal(by.OLD.tier, 'watch');
  assert.ok(by.OLD.badges.some(b => b.text.includes('최근 30일 발생 없음')));
  assert.equal(A.groups[0].trx, 'STEADY');
});

test('급증 규칙: 최근 14일에 처음 급증한 거래는 최소 조치 검토', () => {
  const days = span('2026-08-01', 92);
  const base = rowsFor('BASE', days.filter((_, i) => i % 2 === 0));
  const spike = rowsFor('NEW', span('2026-10-20', 10).concat(span('2026-10-25', 4)));
  const A = C.analyze([].concat(base, spike));
  const g = A.groups.find(x => x.trx === 'NEW');
  assert.notEqual(g.tier, 'watch');
  assert.ok(g.badges.some(b => b.text.includes('급증')));
});

test('심각 ORA 코드는 점수와 무관하게 즉시 조치', () => {
  const rows = [mk({ trx: 'ORA1', ora: 'ORA-00600', d: '2026-10-30' }), mk({ trx: 'OTHER', d: '2026-10-31' })];
  const A = C.analyze(rows);
  assert.equal(A.groups.find(g => g.trx === 'ORA1').tier, 'critical');
});

test('일별 추이: 빈 날짜는 0으로 채우고 합계가 일치한다', () => {
  const A = C.analyze([mk({ d: '2026-10-01' }), mk({ d: '2026-10-05' }), mk({ d: '2026-10-05', g: 'x' })]);
  assert.equal(A.dayKeys.length, 5);
  assert.deepEqual(A.total, [1, 0, 0, 0, 2]);
  const w = C.aggregate(A.dayKeys, A.total, 'week');
  assert.equal(w.values.reduce((a, b) => a + b, 0), 3);
  const m = C.aggregate(A.dayKeys, A.total, 'month');
  assert.deepEqual(m.values, [3]);
});

test('보고서: 핵심 섹션·순위·일별 추이가 들어가고 IP/원본 이메일 같은 값은 없다', () => {
  const days = span('2026-08-01', 92);
  const steady = rowsFor('STEADY', days.filter((_, i) => i % 3 === 0).concat(days.slice(-20)), { scr: '710001' });
  const other = rowsFor('OTHER', days.slice(0, 5));
  const A = C.analyze([].concat(steady, other));
  const txt = C.generateReport(A, { files: ['a.xlsx', 'b.xlsx'], now: new Date(2026, 10, 9, 14, 5) });
  assert.ok(txt.includes('오류 분석 보고서'));
  assert.ok(txt.includes('작성일시 : 2026-11-09 14:05'));
  assert.ok(txt.includes('분석파일 : a.xlsx, b.xlsx'));
  for (const s of ['[1] 요약', '[2] 즉시 조치 대상', '[3] 조치 검토 대상', '[4] 관찰 대상', '[5] 일자별 오류 발생 추이', '[6] 점수 계산 방식']) assert.ok(txt.includes(s), s);
  assert.ok(txt.includes('화면 710001'));
  // 일별 추이: 기간의 모든 날짜가 한 줄씩
  assert.equal(A.dayKeys.every(d => txt.includes('  ' + d + '(')), true);
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(txt), 'IP 형태 문자열이 있음');
  assert.ok(txt.endsWith('\r\n'));
  assert.ok(!/undefined|NaN|\[object/.test(txt), '값이 비어 있는 곳이 있음: ' + (txt.match(/.*(undefined|NaN|\[object).*/) || [''])[0]);
  assert.ok(txt.includes('1) 화면 710001'), '순위 번호');
  assert.equal(A.groups[0].rank, 1);
});

test('보고서: 한글 폭을 반영해 관찰 표 컬럼이 맞는다', () => {
  const days = span('2026-08-01', 40);
  const A = C.analyze(rowsFor('W1', days.slice(0, 3)).concat(rowsFor('W2', days.slice(0, 2), { scr: '' })));
  const lines = C.generateReport(A, {}).split('\r\n');
  const hi = lines.findIndex(l => l.includes('화면·오퍼레이션'));
  assert.ok(hi > 0);
  assert.ok(lines[hi + 1].includes('XDao.sel'));
});

test('analyze: 빈 입력은 null', () => { assert.equal(C.analyze([]), null); });
