// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 모두 손으로 계산한 값입니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('CAN ID 읽기');
test('16진수 기본: 1A0 → 416', () => assert.equal(L.parseId('1A0', 'hex'), 416));
test('0x 접두는 10진수 설정이어도 16진수', () => assert.equal(L.parseId('0x1A0', 'dec'), 416));
test('h 접미 16진수', () => assert.equal(L.parseId('7FFh', 'dec'), 0x7FF));
test('10진수 설정: 416 → 416', () => assert.equal(L.parseId('416', 'dec'), 416));
test('잘못된 값은 null', () => { assert.equal(L.parseId('ABC', 'dec'), null); assert.equal(L.parseId('G1', 'hex'), null); assert.equal(L.parseId('', 'hex'), null); });
test('29비트 초과는 null', () => assert.equal(L.parseId('0x20000000', 'hex'), null));
test('표시: 표준 3자리, 확장 8자리', () => { assert.equal(L.formatId(0x1A), '0x01A'); assert.equal(L.formatId(0x18FF12A0), '0x18FF12A0'); assert.equal(L.formatId(0x800), '0x00000800'); });
test('숫자 읽기: 100ms, 1,000, Cyclic 20', () => { assert.equal(L.parseNumber('100ms'), 100); assert.equal(L.parseNumber('1,000'), 1000); assert.equal(L.parseNumber('Cyclic 20'), 20); assert.ok(isNaN(L.parseNumber('Event'))); });

console.log('TRC 파서');
const trc11 = [
  ';$FILEVERSION=1.1',
  ';   Message Number',
  '     1)         0.0  Rx         0100  8  01 02 03 04 05 06 07 08',
  '     2)        10.5  Rx         0100  8  01 02 03 04 05 06 07 08',
  '     3)        12.0  Tx     18FF12A0  2  AA BB',
  '     4)        13.0  Rx         0200  0  RTR',
  '     5)        14.0  Error  00000004  4  00 00 08 00',
  '     6)        15.0  Rx         0300  3  01 02',
  '     7)  garbage line'
].join('\r\n');
const p11 = L.parseTrc(trc11);
test('1.1: 버전은 머리말에서', () => { assert.equal(p11.version, '1.1'); assert.equal(p11.versionFromHeader, true); });
test('1.1: 데이터 3개·원격 1·에러 1', () => assert.deepEqual(p11.counts, { data: 3, remote: 1, error: 1, other: 0 }));
test('1.1: 길이 3인데 바이트 2개인 줄과 깨진 줄은 읽지 못한 줄 2개', () => { assert.equal(p11.badCount, 2); assert.deepEqual(p11.bad.map(b => b.line), [8, 9]); });
test('1.1: 프레임 값', () => {
  assert.deepEqual(p11.frames[1], { t: 10.5, id: 0x100, bus: null, dir: 'Rx', type: '', len: 8, data: [1, 2, 3, 4, 5, 6, 7, 8], kind: 'data', line: 4 });
  assert.equal(p11.frames[2].id, 0x18FF12A0);
  assert.equal(p11.frames[2].len, 2);
});

const trc20 = [
  ';$FILEVERSION=2.0',
  ';$COLUMNS=N,O,T,I,d,l,D',
  '      1         5.000 DT     0120 Rx 8  00 00 00 00 00 00 00 00',
  '      2        25.250 DT     0120 Rx 8  00 00 00 00 00 00 00 00',
  '      3        30.000 ST          Rx    00 00 00 04'
].join('\n');
const p20 = L.parseTrc(trc20);
test('2.0: $COLUMNS 를 따른다', () => { assert.deepEqual(p20.columns, ['N', 'O', 'T', 'I', 'd', 'l', 'D']); assert.equal(p20.frames.length, 2); assert.equal(p20.frames[1].t, 25.25); });
test('2.0: 상태(ST) 줄은 기타로 센다', () => { assert.equal(p20.counts.other, 1); assert.equal(p20.badCount, 0); });

const trc21 = [
  ';$FILEVERSION=2.1',
  ';$COLUMNS=N,O,T,B,I,d,R,L,D',
  '      1         1.000 DT  1      0100 Rx -  8    00 00 00 00 00 00 00 00',
  '      2         2.000 FD  2      0101 Rx -  9    00 00 00 00 00 00 00 00 00 00 00 00',
  '      3         3.000 ER  1         - Rx -  5    04 00 08 00 00'
].join('\n');
const p21 = L.parseTrc(trc21);
test('2.1: CAN FD DLC 코드 9 → 12바이트', () => { assert.equal(p21.frames[1].len, 12); assert.equal(p21.frames[1].bus, 2); });
test('2.1: 채널 목록과 에러 프레임', () => { assert.deepEqual(p21.buses, [1, 2]); assert.equal(p21.counts.error, 1); });
test('머리말 없는 1.1 모양은 짐작', () => {
  const p = L.parseTrc('     1)      1841.0  Rx     0001  8  00 00 00 00 00 00 00 00');
  assert.equal(p.version, '1.1'); assert.equal(p.versionFromHeader, false); assert.equal(p.frames.length, 1);
});
test('머리말 없는 2.1 모양은 짐작', () => {
  assert.equal(L.guessVersion('1 1059.900 DT 1 0300 Rx - 7 00 00 00 00 04 00 00'.split(' ')), '2.1');
  assert.equal(L.guessVersion('1 1059.900 DT 0300 Rx 7 00 00 00 00 04 00 00'.split(' ')), '2.0');
  assert.equal(L.guessVersion('1) 1059.9 1 Rx 0300 - 7'.split(' ')), '1.3');
});

console.log('DBC 엑셀 열 매핑');
const aoa = [
  ['사내 DBC 정리표'],
  [],
  ['No', 'Msg ID', 'Message Name', 'Signal Name', 'Signal Length(bit)', 'Cycle Time', 'DLC', 'Tx ECU'],
  ['1', '100', 'A', 's1', '8', '10ms', '8', 'EMS'],
  ['2', '', '', 's2', '8', '', '', ''],
  ['3', '100', 'A', 's3', '4', '20', '8', 'EMS'],
  ['4', '1A0', 'B', 's1', '8', '', '6', ''],
  ['5', '1A0', '', 's2', '8', '50', '', 'ESC'],
  ['6', 'ZZ', 'C', 's1', '8', '10', '8', 'X'],
  ['7', '200', 'D', 's1', '8', '100', '9x', 'BCM']
];
test('머리행 짐작: 3번째 줄(0부터 2)', () => assert.equal(L.guessHeaderRow(aoa), 2));
test('열 짐작: 신호 길이 열은 DLC 로 잡지 않는다', () => assert.deepEqual(L.guessMapping(aoa[2]), { id: 1, name: 2, period: 5, dlc: 6, sender: 7 }));
const built = L.buildMessageTable(aoa, 2, L.guessMapping(aoa[2]), { idFormat: 'hex' });
test('같은 ID 는 하나로: 0x100, 0x1A0, 0x200 세 개', () => assert.deepEqual(built.messages.map(m => m.key), ['0x100', '0x1A0', '0x200']));
test('빈 칸은 뒤 줄 값으로 채움: 0x1A0 주기 50·송신 ESC', () => { const m = built.messages[1]; assert.equal(m.period, 50); assert.equal(m.sender, 'ESC'); assert.equal(m.dlc, 6); assert.equal(m.row, 7); });
test('값이 다르면 충돌로 알리고 처음 값 유지: 0x100 주기 10/20', () => {
  assert.equal(built.messages[0].period, 10);
  assert.deepEqual(built.conflicts, [{ id: 0x100, key: '0x100', field: 'period', values: [10, 20], rows: [4, 6] }]);
});
test('읽지 못한 ID·DLC 는 오류 목록, 빈 ID 줄은 건너뜀', () => {
  assert.deepEqual(built.errors, [{ row: 9, code: 'bad_id', value: 'ZZ' }, { row: 10, code: 'bad_dlc', value: '9x' }]);
  assert.equal(built.blankRows, 1);
  assert.equal(built.messages[2].dlc, null);
});
test('10진수 표기로 읽으면 100 → 0x064', () => {
  const b = L.buildMessageTable([['ID'], ['100']], 0, { id: 0, name: -1, period: -1, dlc: -1, sender: -1 }, { idFormat: 'dec' });
  assert.equal(b.messages[0].key, '0x064');
});

console.log('검사');
const msgs = [
  { id: 0x100, key: '0x100', name: 'A', period: 10, dlc: 8, sender: 'EMS' },
  { id: 0x200, key: '0x200', name: 'B', period: 20, dlc: 4, sender: 'BCM' },
  { id: 0x300, key: '0x300', name: 'C', period: 100, dlc: 8, sender: 'X' },
  { id: 0x400, key: '0x400', name: 'E', period: null, dlc: 8, sender: 'T' },
  { id: 0x500, key: '0x500', name: 'F', period: 50, dlc: 8, sender: 'T' }
];
function fr(t, id, len, bus) { return { t, id, len, bus: bus == null ? null : bus, data: [], line: 0 }; }
// 0x100: 0, 10, 21.5, 30, 40 → 간격 10, 11.5, 8.5, 10 (허용 10% = 9~11 → 11.5 김, 8.5 짧음)
// 0x200: 0, 20, 40 길이 4,5,4 → DLC 불일치 1
// 0x400: 주기 없음, 0x500: 1개, 0x7FF: DBC 에 없음 2개, 0x300: 로그에 없음
const frames = [fr(0, 0x100, 8), fr(10, 0x100, 8), fr(21.5, 0x100, 8), fr(30, 0x100, 8), fr(40, 0x100, 8),
  fr(0, 0x200, 4), fr(20, 0x200, 5), fr(40, 0x200, 4),
  fr(5, 0x400, 8), fr(7, 0x400, 8), fr(9, 0x500, 8), fr(3, 0x7FF, 8), fr(50, 0x7FF, 8)];
const rep = L.analyze(msgs, frames, { tolerancePct: 10 });
const row = k => rep.rows.find(r => r.key === k);
test('0x100 통계: 평균 10, 최소 8.5, 최대 11.5, 지터 3', () => {
  const r = row('0x100');
  assert.equal(r.count, 5); assert.equal(r.mean, 10); assert.equal(r.min, 8.5); assert.equal(r.max, 11.5); assert.equal(r.jitter, 3);
});
test('0x100 주기 이탈 2건(짧음 1·김 1), 가장 벗어난 간격 11.5', () => {
  const r = row('0x100');
  assert.equal(r.periodViolations, 2); assert.equal(r.shortCount, 1); assert.equal(r.longCount, 1); assert.equal(r.worst, 11.5);
  assert.deepEqual(r.issues, ['PERIOD']);
});
test('허용 오차 경계값(정확히 ±10%)은 이탈이 아님', () => {
  const r = L.analyze([msgs[0]], [fr(0, 0x100, 8), fr(11, 0x100, 8), fr(20, 0x100, 8)], { tolerancePct: 10 });
  assert.equal(r.rows[0].periodViolations, 0);
});
test('허용 오차 20%면 0x100 이탈 0건', () => assert.equal(L.analyze(msgs, frames, { tolerancePct: 20 }).rows[0].periodViolations, 0));
test('0x200 DLC 불일치 1건, 로그 DLC 4(2건), 5(1건)', () => {
  const r = row('0x200');
  assert.equal(r.dlcMismatch, 1); assert.deepEqual(r.issues, ['DLC']); assert.equal(L.dlcSeenText(r), '4(2건), 5(1건)');
});
test('0x300 은 로그에 없음, 0x7FF 는 로그에만 있음(2프레임)', () => {
  assert.deepEqual(row('0x300').issues, ['DBC_ONLY']);
  assert.deepEqual(row('0x7FF').issues, ['LOG_ONLY']); assert.equal(row('0x7FF').count, 2);
});
test('주기 없는 0x400 과 1개뿐인 0x500 은 판정 제외 표시', () => {
  assert.deepEqual(row('0x400').notes, ['NO_PERIOD']); assert.deepEqual(row('0x400').issues, []);
  assert.deepEqual(row('0x500').notes, ['SINGLE']);
});
test('요약 건수', () => {
  const s = rep.summary;
  assert.equal(s.frameCount, 13); assert.equal(s.dbcCount, 5); assert.equal(s.logIdCount, 5);
  assert.equal(s.logOnly, 1); assert.equal(s.logOnlyFrames, 2); assert.equal(s.dbcOnly, 1);
  assert.equal(s.periodChecked, 2); assert.equal(s.periodIds, 1); assert.equal(s.periodIntervals, 2);
  assert.equal(s.dlcIds, 1); assert.equal(s.dlcFrames, 1); assert.equal(s.noPeriod, 1); assert.equal(s.single, 1);
  assert.equal(s.okIds, 2); // 0x400, 0x500
  assert.equal(s.startT, 0); assert.equal(s.endT, 50);
});
test('판정 문구', () => { assert.equal(L.verdict(row('0x300')), 'ID 언매칭(로그에 없음)'); assert.equal(L.verdict(row('0x400')), '정상'); });
test('채널 선택: 채널 2만 검사', () => {
  const r = L.analyze(msgs, [fr(0, 0x100, 8, 1), fr(10, 0x100, 8, 1), fr(0, 0x200, 4, 2)], { tolerancePct: 10, bus: 2 });
  assert.equal(r.summary.frameCount, 1); assert.deepEqual(r.rows[0].issues, ['DBC_ONLY']);
});
test('허용 오차가 없으면 오류', () => assert.throws(() => L.analyze(msgs, frames, {})));

console.log('보고서 시트');
const sheets = L.reportToSheets(rep, { dbcFile: 'a.xlsx', logFile: 'b.trc' });
test('시트 4개', () => assert.deepEqual(Object.keys(sheets), ['요약', 'ID별 상세', '주기 이탈 구간', 'ID 언매칭']));
test('ID별 상세: 머리 + 6행', () => assert.equal(sheets['ID별 상세'].length, 7));
test('주기 이탈 구간 2행 — 21.5 ms 에서 김', () => {
  assert.equal(sheets['주기 이탈 구간'].length, 3);
  assert.deepEqual(sheets['주기 이탈 구간'][1].slice(0, 7), ['0x100', 'A', 10, 21.5, 11.5, 10, '김(늦음·누락 의심)']);
});
test('ID 언매칭 시트: 로그에만 1 + DBC 에만 1', () => assert.equal(sheets['ID 언매칭'].length, 3));
test('표시 한도를 넘으면 안내 줄', () => {
  const s2 = L.reportToSheets(rep, {}, 1);
  assert.equal(s2['주기 이탈 구간'].length, 3); assert.match(s2['주기 이탈 구간'][2][0], /1건 더/);
});

console.log('예시 데이터 전체 흐름 (일부러 넣은 오류를 모두 잡는가)');
const sAoa = Sample.dbcAoa();
const sh = L.guessHeaderRow(sAoa);
const sb = L.buildMessageTable(sAoa, sh, L.guessMapping(sAoa[sh]), { idFormat: 'hex' });
const sp = L.parseTrc(Sample.buildTrc());
const sr = L.analyze(sb.messages, sp.frames, { tolerancePct: 10 });
const srow = k => sr.rows.find(r => r.key === k);
test('예시 DBC 8개 메시지, 오류 0', () => { assert.equal(sb.messages.length, 8); assert.equal(sb.errors.length, 0); assert.equal(sb.conflicts.length, 0); });
test('예시 로그: TRC 2.1, 읽지 못한 줄 0, 에러 프레임 1', () => { assert.equal(sp.version, '2.1'); assert.equal(sp.badCount, 0); assert.equal(sp.counts.error, 1); });
test('0x120 (20ms 인데 25ms) — 80프레임 79구간 전부 이탈', () => { assert.equal(srow('0x120').count, 80); assert.equal(srow('0x120').periodViolations, 79); });
test('0x1A0 누락 2개 — 198프레임, 김 2건', () => { assert.equal(srow('0x1A0').count, 198); assert.equal(srow('0x1A0').longCount, 2); assert.equal(srow('0x1A0').shortCount, 0); });
test('0x2B0 DLC 4 인데 5 — 20프레임 전부 불일치', () => assert.equal(srow('0x2B0').dlcMismatch, 20));
test('0x3F0 로그에 없음, 0x6F1·0x18FF12A0 로그에만 있음', () => {
  assert.deepEqual(srow('0x3F0').issues, ['DBC_ONLY']);
  assert.deepEqual(srow('0x6F1').issues, ['LOG_ONLY']);
  assert.deepEqual(srow('0x18FF12A0').issues, ['LOG_ONLY']);
});
test('정상 스트림(0x100·0x200·0x316)은 이탈 0', () => ['0x100', '0x200', '0x316'].forEach(k => assert.deepEqual(srow(k).issues, [])));
test('0x500 은 주기 없음으로 제외', () => assert.deepEqual(srow('0x500').notes, ['NO_PERIOD']));

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
