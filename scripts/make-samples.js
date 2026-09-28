// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js 의 가상 DBC·로그를 samples/ 에 xlsx·csv·trc 로 씁니다(앱의 「예시 데이터 불러오기」와 같은 원본).
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const aoa = Sample.dbcAoa();

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '예시_DBC');
const xlsxPath = path.join(out, Sample.DBC_FILE);
fs.writeFileSync(xlsxPath, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
const csv = '﻿' + aoa.map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(out, '예시데이터_DBC.csv'), csv);
fs.writeFileSync(path.join(out, Sample.TRC_FILE), Sample.buildTrc());

// 검증: 방금 쓴 xlsx 를 앱과 같은 방식으로 다시 읽어 같은 기준표가 나오는지
const back = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
const read = XLSX.utils.sheet_to_json(back.Sheets['예시_DBC'], { header: 1, raw: false, defval: '' });
const h = L.guessHeaderRow(read);
const a = L.buildMessageTable(read, h, L.guessMapping(read[h]), { idFormat: 'hex' }).messages;
const b = L.buildMessageTable(aoa, L.guessHeaderRow(aoa), L.guessMapping(aoa[L.guessHeaderRow(aoa)]), { idFormat: 'hex' }).messages;
if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('xlsx 왕복 불일치'); process.exit(1); }
const p = L.parseTrc(fs.readFileSync(path.join(out, Sample.TRC_FILE), 'utf8'));
console.log('예시 파일 생성 완료: 메시지 ' + a.length + '개, 로그 데이터 프레임 ' + p.frames.length + '개, 읽지 못한 줄 ' + p.badCount + '개');
