/*
 * CAN 로그 검증 — 순수 로직 모듈 (화면·저장소와 무관)
 * 기획서 8장 1단계: TRC 파서, DBC 엑셀 열 매핑, ID 언매칭·전송 주기·DLC 검사, 보고서 표 만들기.
 * 브라우저에서는 window.CanLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 */
(function (root) {
  'use strict';

  // ── 공통 ─────────────────────────────────────────────
  function str(v) { return v == null ? '' : String(v).trim(); }
  function round(n, d) {
    if (n == null || !isFinite(n)) return null;
    var f = Math.pow(10, d == null ? 3 : d);
    return Math.round(n * f) / f;
  }
  // '100', '100ms', '100 ms', '1,000', 'Cyclic 20' → 첫 숫자. 없으면 NaN
  function parseNumber(v) {
    if (typeof v === 'number') return v;
    var m = str(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  // ── CAN ID ───────────────────────────────────────────
  // '0x1A0', '1A0h', '1A0' (16진수) 또는 '416' (10진수). 0x 접두·h 접미는 항상 16진수.
  function parseId(v, format) {
    var s = str(v).replace(/\s+/g, '');
    if (!s) return null;
    var hex = format !== 'dec';
    if (/^0x/i.test(s)) { s = s.slice(2); hex = true; }
    else if (/h$/i.test(s)) { s = s.slice(0, -1); hex = true; }
    if (hex ? !/^[0-9a-f]+$/i.test(s) : !/^\d+$/.test(s)) return null;
    var n = parseInt(s, hex ? 16 : 10);
    if (!isFinite(n) || n < 0 || n > 0x1FFFFFFF) return null;
    return n;
  }
  function isExtended(id) { return id > 0x7FF; }
  function formatId(id) {
    if (id == null) return '';
    var h = id.toString(16).toUpperCase();
    var w = isExtended(id) ? 8 : 3;
    while (h.length < w) h = '0' + h;
    return '0x' + h;
  }

  // ── TRC 파서 (PEAK PCAN 계열 TRC 공개 형식) ─────────────
  // 열 코드: N 번호, O 시각(ms), T 종류, B 채널, I ID, d 방향, R 예약, L DLC 코드, l 데이터 길이, D 데이터
  var TRC_COLUMNS = {
    '1.0': ['N', 'O', 'I', 'l', 'D'],
    '1.1': ['N', 'O', 'd', 'I', 'l', 'D'],
    '1.2': ['N', 'O', 'B', 'd', 'I', 'l', 'D'],
    '1.3': ['N', 'O', 'B', 'd', 'I', 'R', 'l', 'D'],
    '2.0': ['N', 'O', 'T', 'I', 'd', 'l', 'D'],
    '2.1': ['N', 'O', 'T', 'B', 'I', 'd', 'R', 'L', 'D']
  };
  var FD_DLC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
  var DATA_TYPES = { DT: 1, FD: 1, FB: 1, FE: 1, BI: 1 };

  function isDirWord(t) { return /^(rx|tx)$/i.test(t || ''); }
  function isSmallInt(t) { return /^\d{1,2}$/.test(t || ''); }
  // 머리말에 버전이 없을 때 첫 데이터 줄 모양으로 짐작
  function guessVersion(tokens) {
    if (/\)$/.test(tokens[0])) {
      if (isDirWord(tokens[2]) || /^(error|warng)$/i.test(tokens[2])) return '1.1';
      if (isSmallInt(tokens[2]) && (isDirWord(tokens[3]) || /^(error|warng)$/i.test(tokens[3]))) return tokens[5] === '-' ? '1.3' : '1.2';
      return '1.0';
    }
    if (isSmallInt(tokens[3]) && isDirWord(tokens[5])) return '2.1';
    return '2.0';
  }

  function parseTrc(text) {
    var lines = String(text || '').split(/\r\n|\n|\r/);
    var res = {
      version: null, versionFromHeader: false, columns: null, frames: [],
      counts: { data: 0, remote: 0, error: 0, other: 0 },
      bad: [], badCount: 0, buses: [], lineCount: lines.length
    };
    var headerCols = null;
    var busSeen = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();
      if (!t) continue;
      if (t.charAt(0) === ';') {
        var mv = t.match(/^;\s*\$FILEVERSION\s*=\s*([\d.]+)/i);
        if (mv) { res.version = mv[1]; res.versionFromHeader = true; }
        var mc = t.match(/^;\s*\$COLUMNS\s*=\s*(.+)$/i);
        if (mc) headerCols = mc[1].split(',').map(function (c) { return c.trim(); }).filter(Boolean);
        continue;
      }
      var tok = t.split(/\s+/);
      if (!res.version) res.version = guessVersion(tok);
      if (!res.columns) {
        res.columns = headerCols || TRC_COLUMNS[res.version] || TRC_COLUMNS[res.version.slice(0, 3)] ||
          (res.version.charAt(0) === '2' ? TRC_COLUMNS['2.1'] : TRC_COLUMNS['1.1']);
      }
      var f = parseTrcLine(tok, res.columns);
      if (!f) {
        res.badCount++;
        if (res.bad.length < 20) res.bad.push({ line: i + 1, text: t.slice(0, 120) });
        continue;
      }
      if (f.kind === 'data') {
        f.line = i + 1;
        res.frames.push(f);
        if (f.bus != null) busSeen[f.bus] = 1;
      }
      res.counts[f.kind]++;
    }
    res.buses = Object.keys(busSeen).map(Number).sort(function (a, b) { return a - b; });
    return res;
  }

  function parseTrcLine(tok, cols) {
    var f = { t: null, id: null, bus: null, dir: '', type: '', len: null, data: [], kind: 'data' };
    var dlcCode = null;
    var p = 0;
    for (var c = 0; c < cols.length; c++) {
      var code = cols[c];
      if (code === 'D') {
        var rest = tok.slice(p);
        if (rest.length === 1 && /^rtr$/i.test(rest[0])) { f.kind = 'remote'; p = tok.length; break; }
        for (var k = 0; k < rest.length; k++) {
          if (!/^[0-9a-f]{2}$/i.test(rest[k])) return null;
          f.data.push(parseInt(rest[k], 16));
        }
        p = tok.length;
        break;
      }
      var v = tok[p++];
      if (v == null) return null;
      switch (code) {
        case 'N': if (!/^\d+\)?$/.test(v)) return null; break;
        case 'O': f.t = parseFloat(v); if (!isFinite(f.t)) return null; break;
        case 'T':
          f.type = v.toUpperCase();
          if (f.type === 'RR') f.kind = 'remote';
          else if (f.type === 'ER') f.kind = 'error';
          else if (!DATA_TYPES[f.type]) f.kind = 'other';
          // 에러·상태 줄은 ID 칸이 비어 열 위치가 밀리므로 여기서 끝낸다(건수만 셈)
          if (f.kind === 'error' || f.kind === 'other') return f;
          break;
        case 'B': f.bus = /^\d+$/.test(v) ? parseInt(v, 10) : null; break;
        case 'd':
          f.dir = v;
          if (/^error$/i.test(v)) f.kind = 'error';
          else if (/^warng$/i.test(v)) f.kind = 'other';
          else if (!isDirWord(v)) return null;
          break;
        case 'I':
          if (v === '-') { f.id = null; break; }
          f.id = parseId(v, 'hex');
          if (f.id == null) return null;
          break;
        case 'R': break;
        case 'L': dlcCode = parseInt(v, 10); break;
        case 'l': f.len = parseInt(v, 10); if (!isFinite(f.len)) return null; break;
        default: break; // 모르는 열은 건너뜀
      }
    }
    if (f.kind !== 'data') return f;
    if (f.len == null && dlcCode != null && isFinite(dlcCode)) f.len = FD_DLC[dlcCode] != null ? FD_DLC[dlcCode] : dlcCode;
    if (f.id == null || f.t == null || f.len == null) return null;
    if (f.data.length !== f.len) return null; // 길이 표기와 실제 바이트 수가 다르면 깨진 줄로 본다
    return f;
  }

  // ── DBC 엑셀 → 메시지 기준표 ───────────────────────────
  var DBC_FIELDS = [
    { key: 'id', label: '메시지 ID', required: true },
    { key: 'name', label: '메시지 이름' },
    { key: 'period', label: '전송 주기(ms)' },
    { key: 'dlc', label: 'DLC(데이터 길이)' },
    { key: 'sender', label: '송신 ECU' }
  ];
  var GUESS = {
    id: { inc: /(메시지|message|msg|frame|can)\s*_?\s*id|^id$|식별자/i, exc: /신호|signal/i },
    name: { inc: /(메시지|message|msg|frame)\s*_?\s*(이름|명|name)|^name$|^이름$|^메시지$/i, exc: /신호|signal/i },
    period: { inc: /주기|cycle|period|interval|cyc/i, exc: /^$/ },
    dlc: { inc: /dlc|데이터\s*길이|message\s*length|msg\s*length|byte|바이트|^length$|^길이$/i, exc: /신호|signal|bit|비트/i },
    sender: { inc: /송신|sender|transmitter|tx\s*node|ecu|^node$/i, exc: /수신|receiver|rx/i }
  };
  function guessMapping(headers) {
    var m = {}, used = {};
    DBC_FIELDS.forEach(function (fd) {
      m[fd.key] = -1;
      var g = GUESS[fd.key];
      for (var i = 0; i < headers.length; i++) {
        var h = str(headers[i]);
        if (!h || used[i]) continue;
        if (g.inc.test(h) && !g.exc.test(h)) { m[fd.key] = i; used[i] = 1; break; }
      }
    });
    return m;
  }
  // 위쪽 제목 줄을 건너뛰고 머리행을 찾는다: 앞 20줄 중 ID 열이 짐작되는 첫 줄
  function guessHeaderRow(aoa) {
    var n = Math.min(aoa.length, 20);
    for (var i = 0; i < n; i++) if (guessMapping(aoa[i] || []).id >= 0) return i;
    for (var j = 0; j < n; j++) {
      var filled = (aoa[j] || []).filter(function (c) { return str(c) !== ''; }).length;
      if (filled >= 2) return j;
    }
    return 0;
  }

  function buildMessageTable(aoa, headerRow, mapping, opts) {
    opts = opts || {};
    var byId = {}, order = [];
    var errors = [], conflicts = [], conflictSeen = {};
    var blankRows = 0, dataRows = 0;
    function cell(row, key) { var c = mapping[key]; return c == null || c < 0 ? '' : str(row[c]); }
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      if (!row.some(function (c) { return str(c) !== ''; })) continue;
      dataRows++;
      var rawId = cell(row, 'id');
      if (!rawId) { blankRows++; continue; } // 신호 줄에 메시지 ID 가 비어 있는 경우(병합 셀 등)
      var id = parseId(rawId, opts.idFormat);
      if (id == null) { errors.push({ row: r + 1, code: 'bad_id', value: rawId }); continue; }
      var per = parseNumber(cell(row, 'period'));
      var dlcRaw = cell(row, 'dlc');
      // '8', '8 byte', '8바이트' 만 받는다
      var dlc = /^\d+\s*(bytes?|바이트)?$/i.test(dlcRaw) ? parseInt(dlcRaw, 10) : NaN;
      if (dlcRaw !== '' && !(dlc >= 0 && dlc <= 64)) {
        errors.push({ row: r + 1, code: 'bad_dlc', value: dlcRaw });
        dlc = NaN;
      }
      var rec = {
        name: cell(row, 'name'),
        period: per > 0 ? per : null,
        dlc: isFinite(dlc) ? dlc : null,
        sender: cell(row, 'sender')
      };
      var cur = byId[id];
      if (!cur) {
        cur = byId[id] = { id: id, key: formatId(id), name: rec.name, period: rec.period, dlc: rec.dlc, sender: rec.sender, row: r + 1 };
        order.push(id);
        continue;
      }
      ['name', 'period', 'dlc', 'sender'].forEach(function (k) {
        var a = cur[k], b = rec[k];
        if (b == null || b === '') return;
        if (a == null || a === '') { cur[k] = b; return; }
        if (a !== b) {
          var ck = id + '|' + k;
          if (!conflictSeen[ck]) {
            conflictSeen[ck] = { id: id, key: formatId(id), field: k, values: [a], rows: [cur.row] };
            conflicts.push(conflictSeen[ck]);
          }
          var c = conflictSeen[ck];
          if (c.values.indexOf(b) < 0) { c.values.push(b); c.rows.push(r + 1); }
        }
      });
    }
    return {
      messages: order.map(function (id) { return byId[id]; }),
      errors: errors, conflicts: conflicts, blankRows: blankRows, dataRows: dataRows
    };
  }

  // ── 검사 ────────────────────────────────────────────
  // settings: { tolerancePct: 허용 오차(%), bus: 채널 번호 또는 null(전체) }
  function analyze(messages, frames, settings) {
    settings = settings || {};
    var tol = Number(settings.tolerancePct);
    if (!(tol >= 0)) throw new Error('허용 오차(%)를 0 이상 숫자로 넣어야 합니다');
    var bus = settings.bus == null || settings.bus === '' ? null : Number(settings.bus);
    var dbc = {};
    messages.forEach(function (m) { dbc[m.id] = m; });

    var groups = {}, idOrder = [];
    var used = 0, tStart = null, tEnd = null;
    frames.forEach(function (f) {
      if (bus != null && f.bus !== bus) return;
      used++;
      if (tStart == null || f.t < tStart) tStart = f.t;
      if (tEnd == null || f.t > tEnd) tEnd = f.t;
      if (!groups[f.id]) { groups[f.id] = []; idOrder.push(f.id); }
      groups[f.id].push(f);
    });

    var rows = [], violations = [];
    function makeRow(id, m, list) {
      var row = {
        id: id, key: formatId(id), name: m ? m.name : '', sender: m ? m.sender : '',
        dbcPeriod: m ? m.period : null, dbcDlc: m ? m.dlc : null,
        count: list ? list.length : 0,
        mean: null, min: null, max: null, jitter: null,
        periodChecked: false, periodViolations: 0, shortCount: 0, longCount: 0, worst: null,
        dlcSeen: [], dlcMismatch: 0,
        firstT: null, lastT: null,
        issues: [], notes: []
      };
      if (!m) row.issues.push('LOG_ONLY');
      if (!list || !list.length) { row.issues.push('DBC_ONLY'); return row; }
      list.sort(function (a, b) { return a.t - b.t; });
      row.firstT = list[0].t; row.lastT = list[list.length - 1].t;
      var lens = {};
      list.forEach(function (f) {
        lens[f.len] = (lens[f.len] || 0) + 1;
        if (m && m.dlc != null && f.len !== m.dlc) row.dlcMismatch++;
      });
      row.dlcSeen = Object.keys(lens).map(Number).sort(function (a, b) { return a - b; })
        .map(function (l) { return { len: l, count: lens[l] }; });
      if (row.dlcMismatch) row.issues.push('DLC');
      if (list.length >= 2) {
        var mn = Infinity, mx = -Infinity;
        for (var i = 1; i < list.length; i++) {
          var iv = list[i].t - list[i - 1].t;
          if (iv < mn) mn = iv;
          if (iv > mx) mx = iv;
        }
        row.mean = (row.lastT - row.firstT) / (list.length - 1);
        row.min = mn; row.max = mx; row.jitter = mx - mn;
      }
      if (!m) return row;
      if (m.period == null) { row.notes.push('NO_PERIOD'); return row; }
      if (list.length < 2) { row.notes.push('SINGLE'); return row; }
      row.periodChecked = true;
      var P = m.period, lo = P * (1 - tol / 100), hi = P * (1 + tol / 100), eps = 1e-9;
      for (var j = 1; j < list.length; j++) {
        var d = list[j].t - list[j - 1].t;
        var kind = d > hi + eps ? 'long' : (d < lo - eps ? 'short' : null);
        if (!kind) continue;
        row.periodViolations++;
        if (kind === 'long') row.longCount++; else row.shortCount++;
        var dev = Math.abs(d - P);
        if (row.worst == null || dev > Math.abs(row.worst - P)) row.worst = d;
        violations.push({ id: id, key: row.key, name: row.name, from: list[j - 1].t, to: list[j].t, interval: d, period: P, kind: kind, line: list[j].line });
      }
      if (row.periodViolations) row.issues.push('PERIOD');
      return row;
    }

    messages.forEach(function (m) { rows.push(makeRow(m.id, m, groups[m.id])); });
    idOrder.filter(function (id) { return !dbc[id]; }).sort(function (a, b) { return a - b; })
      .forEach(function (id) { rows.push(makeRow(id, null, groups[id])); });

    var s = {
      dbcCount: messages.length, logIdCount: idOrder.length, frameCount: used,
      startT: tStart, endT: tEnd,
      logOnly: 0, logOnlyFrames: 0, dbcOnly: 0,
      periodChecked: 0, periodIds: 0, periodIntervals: violations.length,
      dlcIds: 0, dlcFrames: 0, noPeriod: 0, single: 0, okIds: 0,
      tolerancePct: tol, bus: bus
    };
    rows.forEach(function (r) {
      if (r.issues.indexOf('LOG_ONLY') >= 0) { s.logOnly++; s.logOnlyFrames += r.count; }
      if (r.issues.indexOf('DBC_ONLY') >= 0) s.dbcOnly++;
      if (r.periodChecked) s.periodChecked++;
      if (r.issues.indexOf('PERIOD') >= 0) s.periodIds++;
      if (r.issues.indexOf('DLC') >= 0) { s.dlcIds++; s.dlcFrames += r.dlcMismatch; }
      if (r.notes.indexOf('NO_PERIOD') >= 0) s.noPeriod++;
      if (r.notes.indexOf('SINGLE') >= 0) s.single++;
      if (!r.issues.length) s.okIds++;
    });
    return { summary: s, rows: rows, violations: violations };
  }

  var ISSUE_LABEL = {
    LOG_ONLY: 'ID 언매칭(로그에만 있음)',
    DBC_ONLY: 'ID 언매칭(로그에 없음)',
    PERIOD: '전송 주기 이탈',
    DLC: 'DLC 불일치'
  };
  var NOTE_LABEL = {
    NO_PERIOD: 'DBC 주기 없음 — 주기 검사 제외',
    SINGLE: '프레임 1개 — 주기 판정 불가'
  };
  function verdict(row) {
    return row.issues.length ? row.issues.map(function (c) { return ISSUE_LABEL[c]; }).join(', ') : '정상';
  }
  function dlcSeenText(row) {
    return row.dlcSeen.map(function (d) { return d.len + '(' + d.count + '건)'; }).join(', ');
  }

  // ── 보고서 → 엑셀 시트(2차원 배열) ─────────────────────
  function reportToSheets(report, meta, limit) {
    meta = meta || {};
    limit = limit || 20000;
    var s = report.summary;
    var summary = [
      ['CAN 데이터 유효성 검증 보고서 (1단계)'],
      ['항목', '값'],
      ['작성 시각', meta.createdAt || ''],
      ['DBC 파일', meta.dbcFile || ''],
      ['로그 파일', meta.logFile || ''],
      ['TRC 형식 버전', meta.trcVersion || ''],
      ['채널', s.bus == null ? '전체' : String(s.bus)],
      ['주기 허용 오차(%)', s.tolerancePct],
      ['로그 구간(ms)', s.startT == null ? '' : round(s.startT) + ' ~ ' + round(s.endT)],
      ['검사한 데이터 프레임 수', s.frameCount],
      ['DBC 메시지 수', s.dbcCount],
      ['로그에 나온 ID 수', s.logIdCount],
      [],
      ['검사 항목', '이상 ID 수', '이상 건수'],
      ['ID 언매칭 — 로그에만 있음(DBC 미정의)', s.logOnly, s.logOnlyFrames],
      ['ID 언매칭 — DBC 에만 있음(로그에 없음)', s.dbcOnly, s.dbcOnly],
      ['전송 주기 이탈', s.periodIds, s.periodIntervals],
      ['DLC 불일치', s.dlcIds, s.dlcFrames],
      [],
      ['주기 검사한 ID 수', s.periodChecked],
      ['DBC 주기 없음(주기 검사 제외)', s.noPeriod],
      ['프레임 1개(주기 판정 불가)', s.single],
      ['이상 없는 ID 수', s.okIds]
    ];
    if (meta.otherCounts) {
      summary.push([], ['참고 — 데이터 외 기록(1단계는 판정하지 않음)', '건수']);
      summary.push(['에러 프레임', meta.otherCounts.error], ['원격(RTR) 프레임', meta.otherCounts.remote], ['기타(상태 등)', meta.otherCounts.other]);
    }
    var detail = [['메시지 ID', '메시지 이름', '송신 ECU', 'DBC 주기(ms)', '프레임 수', '평균 주기(ms)', '최소(ms)', '최대(ms)', '지터(최대-최소, ms)',
      '주기 이탈 건수', '짧음', '김', '가장 벗어난 간격(ms)', 'DBC DLC', '로그 DLC(건수)', 'DLC 불일치 건수', '판정', '비고']];
    report.rows.forEach(function (r) {
      detail.push([r.key, r.name, r.sender, r.dbcPeriod, r.count, round(r.mean), round(r.min), round(r.max), round(r.jitter),
        r.periodChecked ? r.periodViolations : '', r.periodChecked ? r.shortCount : '', r.periodChecked ? r.longCount : '', round(r.worst),
        r.dbcDlc, dlcSeenText(r), r.dbcDlc == null ? '' : r.dlcMismatch, verdict(r),
        r.notes.map(function (n) { return NOTE_LABEL[n]; }).join(', ')]);
    });
    var viol = [['메시지 ID', '메시지 이름', '앞 프레임 시각(ms)', '이 프레임 시각(ms)', '간격(ms)', 'DBC 주기(ms)', '구분', '로그 줄 번호']];
    report.violations.slice(0, limit).forEach(function (v) {
      viol.push([v.key, v.name, round(v.from), round(v.to), round(v.interval), v.period, v.kind === 'long' ? '김(늦음·누락 의심)' : '짧음(빠름)', v.line]);
    });
    if (report.violations.length > limit) viol.push(['… ' + (report.violations.length - limit) + '건 더 있음(표시 한도 ' + limit + '건)']);
    var unmatched = [['구분', '메시지 ID', '메시지 이름', '송신 ECU', '로그 프레임 수']];
    report.rows.forEach(function (r) {
      if (r.issues.indexOf('LOG_ONLY') >= 0) unmatched.push(['로그에만 있음(DBC 미정의)', r.key, '', '', r.count]);
    });
    report.rows.forEach(function (r) {
      if (r.issues.indexOf('DBC_ONLY') >= 0) unmatched.push(['DBC 에만 있음(로그에 없음)', r.key, r.name, r.sender, 0]);
    });
    return { '요약': summary, 'ID별 상세': detail, '주기 이탈 구간': viol, 'ID 언매칭': unmatched };
  }

  // 기준표 ↔ 시트 (정리된 기준표를 내보내고 다시 불러오기)
  var MSG_HEADERS = ['메시지 ID', '메시지 이름', '전송 주기(ms)', 'DLC', '송신 ECU'];
  function messagesToSheet(messages) {
    return [MSG_HEADERS].concat(messages.map(function (m) { return [m.key, m.name, m.period, m.dlc, m.sender]; }));
  }

  var api = {
    str: str, round: round, parseNumber: parseNumber,
    parseId: parseId, formatId: formatId, isExtended: isExtended,
    TRC_COLUMNS: TRC_COLUMNS, parseTrc: parseTrc, guessVersion: guessVersion,
    DBC_FIELDS: DBC_FIELDS, guessMapping: guessMapping, guessHeaderRow: guessHeaderRow, buildMessageTable: buildMessageTable,
    analyze: analyze, ISSUE_LABEL: ISSUE_LABEL, NOTE_LABEL: NOTE_LABEL, verdict: verdict, dlcSeenText: dlcSeenText,
    reportToSheets: reportToSheets, MSG_HEADERS: MSG_HEADERS, messagesToSheet: messagesToSheet
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanLogic = api;
})(typeof window !== 'undefined' ? window : this);
