/* 엑셀 → data.json 변환.
 * 사용: node scripts/build-data.cjs [엑셀이 있는 폴더(기본: 상위 폴더)]
 * 폴더 안의 *.xlsx / *.xls / *.csv 를 모두 읽어 합친다(중복 행 제거). */
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const Core = require('../core.js');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const files = fs.readdirSync(dir).filter(f => /\.(xlsx|xls|csv)$/i.test(f) && !f.startsWith('~$')).sort();
if (!files.length) { console.error('엑셀 파일이 없습니다:', dir); process.exit(1); }

let records = [];
for (const f of files) {
  // 브라우저용 번들은 readFile 이 없으므로 직접 읽어서 파싱
  const wb = XLSX.read(fs.readFileSync(path.join(dir, f)), { type: 'buffer' });
  let n = 0;
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
    const recs = Core.recordsFromAoa(aoa);
    n += recs.length;
    records = records.concat(recs);
  }
  console.log(f.padEnd(28), n, '행');
}

const { rows, sqls } = Core.buildDataset(records);
const out = { generatedAt: new Date().toISOString(), files, rows, sqls };
const dest = path.join(__dirname, '..', 'data.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log('합계', rows.length, '건 →', dest, '(' + Math.round(fs.statSync(dest).size / 1024) + 'KB)');
