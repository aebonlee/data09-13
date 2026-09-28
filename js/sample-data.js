/*
 * 예시 데이터 — 시연·시험용으로 지어낸 가상의 CAN DBC 정리표와 TRC 로그입니다.
 * 실제 차량·제조사 사양이 아닙니다. 메시지 이름에는 모두 EX_(예시) 를 붙였습니다.
 * 검사가 잡는지 보려고 일부러 넣은 오류(기획서 8장 1단계):
 *   0x120 — DBC 주기 20ms 인데 로그는 25ms 간격(주기 이탈, 전 구간)
 *   0x1A0 — 10ms 주기 중 프레임 2개 누락(간격 약 20ms 두 번)
 *   0x2B0 — DBC DLC 4 인데 로그는 5바이트(DLC 불일치)
 *   0x3F0 — DBC 에는 있는데 로그에 한 번도 안 나옴(ID 언매칭)
 *   0x6F1, 0x18FF12A0 — 로그에만 있고 DBC 에 없음(ID 언매칭)
 *   0x500 — DBC 주기가 비어 있는 이벤트 메시지(주기 검사 제외)
 */
(function (root) {
  'use strict';

  var DBC_FILE = '예시데이터_DBC.xlsx';
  var TRC_FILE = '예시데이터_로그.trc';

  // 시트 모양: 위에 안내 줄, 빈 줄, 머리행. 신호마다 한 줄이고 두 번째 신호 줄은 메시지 칸을 비움(병합 셀처럼)
  function dbcAoa() {
    return [
      ['예시 데이터 — 가상의 CAN DBC 정리표입니다. 실제 차량 사양이 아닙니다.'],
      [],
      ['Msg ID', '메시지 이름', '송신 ECU', '주기(ms)', 'DLC', '신호 이름', '시작 비트', '길이(bit)'],
      ['0x100', 'EX_ENG_STATUS', 'EX_EMS', '10', '8', 'EX_EngSpeed', '0', '16'],
      ['', '', '', '', '', 'EX_EngTemp', '16', '8'],
      ['0x120', 'EX_TCU_GEAR', 'EX_TCU', '20', '8', 'EX_GearPos', '0', '4'],
      ['0x1A0', 'EX_BRAKE_PRESS', 'EX_ESC', '10', '8', 'EX_BrkPress', '0', '12'],
      ['', '', '', '', '', 'EX_BrkSwitch', '12', '1'],
      ['0x200', 'EX_STEER_ANGLE', 'EX_MDPS', '10', '8', 'EX_StrAngle', '0', '16'],
      ['0x2B0', 'EX_BODY_LAMP', 'EX_BCM', '100', '4', 'EX_HeadLamp', '0', '2'],
      ['0x316', 'EX_VEH_SPEED', 'EX_ESC', '20', '8', 'EX_VehSpeed', '0', '16'],
      ['0x3F0', 'EX_DOOR_STATE', 'EX_BCM', '100', '2', 'EX_DoorFL', '0', '1'],
      ['0x500', 'EX_DIAG_REQ', 'EX_TESTER', '', '8', 'EX_DiagData', '0', '64']
    ];
  }

  // 로그 2초. 시각 = 시작 위상 + k × 간격 + 작은 흔들림(±0.3ms 이내, 고정 패턴)
  var STREAMS = [
    { id: 0x100, phase: 0.5, step: 10, len: 8 },
    { id: 0x120, phase: 1.1, step: 25, len: 8 },
    { id: 0x1A0, phase: 2.3, step: 10, len: 8, drop: [50, 120] },
    { id: 0x200, phase: 3.4, step: 10, len: 8 },
    { id: 0x2B0, phase: 4.5, step: 100, len: 5 },
    { id: 0x316, phase: 5.6, step: 20, len: 8 },
    { id: 0x500, phase: 777.7, step: 100000, len: 8 },
    { id: 0x6F1, phase: 6.7, step: 100, len: 8 },
    { id: 0x18FF12A0, phase: 7.8, step: 200, len: 8 }
  ];
  var DURATION = 2000;

  function hex(n, w) { var h = n.toString(16).toUpperCase(); while (h.length < w) h = '0' + h; return h; }
  function pad(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }

  function frames() {
    var list = [];
    STREAMS.forEach(function (s) {
      for (var k = 0; ; k++) {
        var t = s.phase + k * s.step + (((k * 37) % 7) - 3) / 10;
        if (t >= DURATION) break;
        if (s.drop && s.drop.indexOf(k) >= 0) continue;
        var data = [];
        for (var b = 0; b < s.len; b++) data.push((k * (b + 1) + (s.id & 0xFF)) & 0xFF);
        list.push({ t: Math.round(t * 1000) / 1000, id: s.id, len: s.len, data: data });
      }
    });
    // 에러 프레임 1건(1단계는 건수만 알려 줌)
    list.push({ t: 1234.567, error: true });
    list.sort(function (a, b) { return a.t - b.t; });
    return list;
  }

  // PEAK TRC 2.1 형식으로 쓴다
  function buildTrc() {
    var out = [
      ';$FILEVERSION=2.1',
      ';$COLUMNS=N,O,T,B,I,d,R,L,D',
      ';',
      ';   EXAMPLE DATA - synthetic CAN log for demonstration. Not a real vehicle.',
      ';   (예시 데이터 - 시연용 가상 로그)',
      ';',
      ';   Message   Time    Type Bus  ID       Rx/Tx Reserved  DLC  Data',
      ';   Number    Offset',
      ';---+-- ------+------ +- +- --+----- +- +- +- +- -- -- -- -- -- -- --'
    ];
    frames().forEach(function (f, i) {
      var t = f.t.toFixed(3);
      if (f.error) {
        out.push(pad(i + 1, 7) + ' ' + pad(t, 13) + ' ER  1  -        Rx -  5    04 00 08 00 00');
        return;
      }
      var id = f.id > 0x7FF ? hex(f.id, 8) : hex(f.id, 4);
      var data = f.data.map(function (b) { return hex(b, 2); }).join(' ');
      out.push(pad(i + 1, 7) + ' ' + pad(t, 13) + ' DT  1  ' + (id + '        ').slice(0, 8) + ' Rx -  ' + f.len + '    ' + data);
    });
    return out.join('\r\n') + '\r\n';
  }

  var api = { DBC_FILE: DBC_FILE, TRC_FILE: TRC_FILE, dbcAoa: dbcAoa, buildTrc: buildTrc, frames: frames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanSample = api;
})(typeof window !== 'undefined' ? window : this);
