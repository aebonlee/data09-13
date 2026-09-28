/* CAN 로그 검증 — 화면 (1단계)
   화면 3개: 1. DBC 기준표(엑셀 열 매핑) · 2. TRC 로그 · 3. 검증 보고서 */
(function () {
  'use strict';
  var L = window.CanLogic, S = window.CanSample, Store = window.CanStore;
  var main = document.getElementById('main');
  var st = Store.load();
  // 매핑 작업 중인 엑셀(메모리에만) — 새로 열면 다시 선택
  var work = { fileName: '', sheets: null, sheetNames: [], sheet: '', headerRow: 0, mapping: null, build: null };
  // TRC 로그(메모리에만)
  var log = { fileName: '', parsed: null, sample: false };
  var ui = { filter: 'all' };

  // ── 도우미 ──────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n, d) { var r = L.round(n, d == null ? 3 : d); return r == null ? '' : String(r); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function save() { Store.save(st); }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function nowText() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function isSample() { return st.dbcSample || log.sample; }
  function writeXlsx(sheets, name) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n); });
    XLSX.writeFile(wb, name);
  }
  function readSheets(buf) {
    var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    var out = {};
    wb.SheetNames.forEach(function (n) {
      out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
    });
    return { names: wb.SheetNames.slice(), sheets: out };
  }

  // ── 머리·띠 ─────────────────────────────────────────
  function renderNav(route) {
    var items = [
      { href: '#/dbc', label: '1. DBC 기준표', badge: st.messages.length ? st.messages.length + '개' : '' },
      { href: '#/log', label: '2. TRC 로그', badge: log.parsed ? log.parsed.frames.length + '프레임' : '' },
      { href: '#/report', label: '3. 검증 보고서', badge: '' }
    ];
    document.getElementById('nav').innerHTML = items.map(function (it) {
      return '<a href="' + it.href + '"' + (route === it.href ? ' aria-current="page"' : '') + '>' + esc(it.label) +
        (it.badge ? ' <span class="nav-badge">' + esc(it.badge) + '</span>' : '') + '</a>';
    }).join('');
    var b = document.getElementById('sampleBanner');
    if (isSample()) {
      b.hidden = false;
      b.textContent = '예시 데이터 — 시연용으로 지어낸 가상 DBC·로그를 보고 있습니다. 실제 차량·제조사 데이터가 아닙니다.';
    } else b.hidden = true;
  }

  // ── 예시 데이터·초기화 ──────────────────────────────
  function loadSample() {
    var aoa = S.dbcAoa();
    work = { fileName: S.DBC_FILE, sheets: { '예시_DBC': aoa }, sheetNames: ['예시_DBC'], sheet: '예시_DBC', headerRow: 0, mapping: null, build: null };
    work.headerRow = L.guessHeaderRow(aoa);
    work.mapping = L.guessMapping(aoa[work.headerRow] || []);
    st.idFormat = 'hex';
    var built = L.buildMessageTable(aoa, work.headerRow, work.mapping, { idFormat: 'hex' });
    work.build = built;
    st.messages = built.messages; st.dbcFile = S.DBC_FILE; st.dbcSample = true;
    log = { fileName: S.TRC_FILE, parsed: L.parseTrc(S.buildTrc()), sample: true };
    save();
    toast('예시 데이터를 불러왔습니다. 가상 데이터입니다.');
    if (location.hash === '#/report') render(); else location.hash = '#/report';
  }
  function clearAll() {
    if (!confirm('기준표·로그·설정을 모두 지웁니다. 계속할까요?')) return;
    Store.clear();
    st = Store.defaults();
    work = { fileName: '', sheets: null, sheetNames: [], sheet: '', headerRow: 0, mapping: null, build: null };
    log = { fileName: '', parsed: null, sample: false };
    toast('모두 지웠습니다.');
    if (location.hash === '#/dbc') render(); else location.hash = '#/dbc';
  }
  function startCard() {
    return '<section class="card start">' +
      '<h2>시작하기</h2>' +
      '<p>① DBC 엑셀을 열어 열을 맞추고 → ② 실차 TRC 로그를 열면 → ③ 검증 보고서가 나옵니다. 파일은 이 브라우저 안에서만 읽습니다.</p>' +
      '<p class="note">실제 파일이 없으면 「예시 데이터 불러오기」로 가상 DBC·로그를 넣어 흐름을 볼 수 있습니다. 예시에는 주기 이탈·누락 ID·미정의 ID·DLC 불일치를 일부러 넣어 두었습니다.</p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary" data-act="sample">예시 데이터 불러오기</button>' +
      '<button type="button" class="btn btn-danger" data-act="clear">모두 지우기</button></div></section>';
  }

  // ── 1. DBC 기준표 ───────────────────────────────────
  function pageDbc() {
    var h = '<div class="page-head"><h1>1. DBC 기준표</h1></div>' + startCard();
    h += '<section class="card"><h2>DBC 엑셀 열기</h2>' +
      '<p class="note">xlsx·xls·csv 를 열 수 있습니다. 신호마다 한 줄씩 적힌 표도 됩니다 — 같은 메시지 ID 줄은 하나로 합치고, 메시지 ID 칸이 빈 줄(병합 셀 아래 줄 등)은 건너뜁니다.</p>' +
      '<label class="field"><span>파일 선택</span><input type="file" id="dbcFile" accept=".xlsx,.xls,.csv"></label>';
    if (work.sheets) h += mappingForm();
    h += '</section>';
    if (st.messages.length) h += messageCard();
    return h;
  }

  function mappingForm() {
    var aoa = work.sheets[work.sheet] || [];
    var headers = aoa[work.headerRow] || [];
    var width = aoa.reduce(function (w, r) { return Math.max(w, (r || []).length); }, 0);
    var opts = '<option value="-1">(없음)</option>';
    for (var i = 0; i < width; i++) opts += '<option value="' + i + '">' + colName(i) + (L.str(headers[i]) ? ' · ' + esc(L.str(headers[i])) : '') + '</option>';
    var h = '<form id="mapForm" class="map-form">' +
      '<h3>열 맞추기 — ' + esc(work.fileName) + '</h3>' +
      '<p class="note">파일마다 열 이름이 달라서, 어느 열이 무엇인지 여기서 맞춥니다. 열 이름을 보고 미리 짐작해 두었으니 확인만 하시면 됩니다.</p>' +
      '<div class="form-grid cols-3">' +
      '<label class="field"><span>시트</span><select name="sheet">' + work.sheetNames.map(function (n) {
        return '<option' + (n === work.sheet ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>머리행(열 이름이 있는 줄 번호)</span><input type="number" name="headerRow" min="1" max="' + Math.max(1, aoa.length) + '" value="' + (work.headerRow + 1) + '"></label>' +
      '<label class="field"><span>메시지 ID 표기</span><select name="idFormat">' +
      '<option value="hex"' + (st.idFormat !== 'dec' ? ' selected' : '') + '>16진수 (예: 1A0, 0x1A0)</option>' +
      '<option value="dec"' + (st.idFormat === 'dec' ? ' selected' : '') + '>10진수 (예: 416)</option></select></label>' +
      '</div><div class="form-grid cols-3 map-grid">';
    L.DBC_FIELDS.forEach(function (fd) {
      var v = work.mapping ? work.mapping[fd.key] : -1;
      h += '<label class="field"><span>' + esc(fd.label) + (fd.required ? ' (필수)' : '') + '</span><select name="map_' + fd.key + '">' +
        opts.replace('value="' + v + '"', 'value="' + v + '" selected') + '</select></label>';
    });
    h += '</div>';
    // 미리보기: 머리행 + 아래 5줄
    var prev = aoa.slice(work.headerRow, work.headerRow + 6);
    h += '<p class="note">미리보기 (머리행과 아래 5줄)</p><div class="table-wrap"><table class="list compact"><thead><tr><th>줄</th>';
    for (var c = 0; c < width; c++) h += '<th>' + colName(c) + '</th>';
    h += '</tr></thead><tbody>';
    prev.forEach(function (r, k) {
      h += '<tr' + (k === 0 ? ' class="head-row"' : '') + '><td>' + (work.headerRow + k + 1) + '</td>';
      for (var c2 = 0; c2 < width; c2++) h += '<td>' + esc(L.str((r || [])[c2])) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="submit-bar"><button type="submit" class="btn btn-primary btn-big">기준표 만들기</button></div></form>';
    return h;
  }

  function messageCard() {
    var h = '<section class="card"><h2>현재 기준표 — 메시지 ' + st.messages.length + '개</h2>' +
      '<p class="note">파일: ' + esc(st.dbcFile) + (st.dbcSample ? ' (예시 데이터)' : '') + ' · 이 브라우저에 저장되어 다시 열어도 남습니다.</p>';
    var b = work.build;
    if (b) {
      if (b.errors.length) {
        h += '<div class="alert warn"><strong>읽지 못한 줄 ' + b.errors.length + '개</strong><ul>' + b.errors.slice(0, 20).map(function (e) {
          return '<li>' + e.row + '행: ' + (e.code === 'bad_id' ? '메시지 ID 를 읽을 수 없음' : 'DLC 가 0~64 정수가 아님') + ' (「' + esc(e.value) + '」)</li>';
        }).join('') + '</ul></div>';
      }
      if (b.conflicts.length) {
        var fl = { name: '이름', period: '주기', dlc: 'DLC', sender: '송신 ECU' };
        h += '<div class="alert warn"><strong>같은 ID 에 값이 다른 줄 ' + b.conflicts.length + '건</strong> — 처음 나온 값을 썼습니다.<ul>' + b.conflicts.slice(0, 20).map(function (c) {
          return '<li>' + esc(c.key) + ' ' + fl[c.field] + ': ' + c.values.map(esc).join(' / ') + ' (' + c.rows.join(', ') + '행)</li>';
        }).join('') + '</ul></div>';
      }
      if (b.blankRows) h += '<p class="note">메시지 ID 칸이 빈 줄 ' + b.blankRows + '개는 신호 줄로 보고 건너뛰었습니다.</p>';
    }
    var noPer = st.messages.filter(function (m) { return m.period == null; }).length;
    if (noPer) h += '<p class="note">주기가 비어 있는 메시지 ' + noPer + '개는 주기 검사에서 빠집니다(이벤트 전송 등).</p>';
    h += '<div class="table-wrap"><table class="list"><thead><tr><th>메시지 ID</th><th>메시지 이름</th><th>전송 주기(ms)</th><th>DLC</th><th>송신 ECU</th><th>원본 행</th></tr></thead><tbody>' +
      st.messages.map(function (m) {
        return '<tr><td class="mono">' + esc(m.key) + '</td><td>' + esc(m.name) + '</td><td>' + (m.period == null ? '<span class="muted">없음</span>' : esc(m.period)) +
          '</td><td>' + (m.dlc == null ? '<span class="muted">없음</span>' : esc(m.dlc)) + '</td><td>' + esc(m.sender) + '</td><td>' + esc(m.row || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="btn-row gap-top"><button type="button" class="btn" data-act="exportDbc">기준표 엑셀 내보내기</button>' +
      '<a class="btn btn-primary" href="#/log">다음: 2. TRC 로그</a></div></section>';
    return h;
  }

  function bindDbc() {
    var file = document.getElementById('dbcFile');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var r = readSheets(reader.result);
          work = { fileName: f.name, sheets: r.sheets, sheetNames: r.names, sheet: r.names[0], headerRow: 0, mapping: null, build: null };
          regress();
          render();
          toast('엑셀을 열었습니다. 열을 확인한 뒤 「기준표 만들기」를 누르세요.');
        } catch (e) { toast('엑셀을 읽지 못했습니다: ' + e.message, true); }
      };
      reader.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
      reader.readAsArrayBuffer(f);
    });
    var form = document.getElementById('mapForm');
    if (!form) return;
    form.sheet.addEventListener('change', function () { work.sheet = form.sheet.value; regress(); render(); });
    form.headerRow.addEventListener('change', function () {
      var n = parseInt(form.headerRow.value, 10);
      if (!(n >= 1)) return;
      work.headerRow = n - 1;
      work.mapping = L.guessMapping((work.sheets[work.sheet] || [])[work.headerRow] || []);
      render();
    });
    form.idFormat.addEventListener('change', function () { st.idFormat = form.idFormat.value; save(); });
    L.DBC_FIELDS.forEach(function (fd) {
      form['map_' + fd.key].addEventListener('change', function () { work.mapping[fd.key] = parseInt(form['map_' + fd.key].value, 10); });
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!(work.mapping.id >= 0)) { toast('메시지 ID 열은 꼭 골라야 합니다.', true); return; }
      var built = L.buildMessageTable(work.sheets[work.sheet] || [], work.headerRow, work.mapping, { idFormat: st.idFormat });
      if (!built.messages.length) { toast('메시지를 하나도 읽지 못했습니다. 머리행·ID 열·ID 표기를 확인하세요.', true); work.build = built; render(); return; }
      work.build = built;
      st.messages = built.messages; st.dbcFile = work.fileName; st.dbcSample = /^예시데이터/.test(work.fileName);
      save();
      toast('기준표를 만들었습니다: 메시지 ' + built.messages.length + '개');
      render();
    });
  }
  function regress() {
    var aoa = work.sheets[work.sheet] || [];
    work.headerRow = L.guessHeaderRow(aoa);
    work.mapping = L.guessMapping(aoa[work.headerRow] || []);
  }

  // ── 2. TRC 로그 ─────────────────────────────────────
  function pageLog() {
    var h = '<div class="page-head"><h1>2. TRC 로그</h1></div>';
    if (!st.messages.length && !log.parsed) h += startCard();
    h += '<section class="card"><h2>TRC 로그 열기</h2>' +
      '<p class="note">PEAK PCAN 계열 TRC 텍스트 형식(버전 1.0~2.1)을 읽습니다. 머리말의 $FILEVERSION·$COLUMNS 를 따르고, 없으면 첫 줄 모양으로 짐작합니다. 시각 단위는 ms 입니다.</p>' +
      '<p class="note">로그는 크기가 커서 저장하지 않습니다. 새로 열면 다시 선택하세요.</p>' +
      '<label class="field"><span>파일 선택</span><input type="file" id="trcFile" accept=".trc,.txt"></label></section>';
    var p = log.parsed;
    if (p) {
      // 큰 로그에서 Math.min.apply 는 호출 스택을 넘기므로 한 번 훑어 구한다
      var t0 = null, t1 = null, ids = {};
      p.frames.forEach(function (f) {
        ids[f.id] = 1;
        if (t0 == null || f.t < t0) t0 = f.t;
        if (t1 == null || f.t > t1) t1 = f.t;
      });
      h += '<section class="card"><h2>읽은 결과 — ' + esc(log.fileName) + (log.sample ? ' (예시 데이터)' : '') + '</h2>';
      if (!p.frames.length) h += '<div class="alert warn">데이터 프레임을 하나도 읽지 못했습니다. TRC 형식이 아니거나 이 도구가 모르는 버전일 수 있습니다. 파일 앞부분 20줄을 보내 주시면 파서를 맞추겠습니다.</div>';
      h += '<dl class="kv-grid">' +
        kv('형식 버전', (p.version || '알 수 없음') + (p.versionFromHeader ? ' (머리말)' : ' (짐작)')) +
        kv('열 구성', (p.columns || []).join(', ')) +
        kv('데이터 프레임', p.counts.data + '개') +
        kv('로그에 나온 ID', Object.keys(ids).length + '개') +
        kv('시간 범위(ms)', t0 == null ? '-' : num(t0) + ' ~ ' + num(t1)) +
        kv('채널', p.buses.length ? p.buses.join(', ') : '표기 없음') +
        kv('에러 프레임', p.counts.error + '개') +
        kv('원격(RTR)·기타', p.counts.remote + ' / ' + p.counts.other + '개') +
        '</dl>';
      if (p.badCount) {
        h += '<div class="alert warn"><strong>읽지 못한 줄 ' + p.badCount + '개</strong> (앞 ' + p.bad.length + '개 표시)<ul class="mono-list">' +
          p.bad.map(function (b) { return '<li>' + b.line + '행: ' + esc(b.text) + '</li>'; }).join('') + '</ul></div>';
      }
      h += '<p class="note">에러 프레임·원격 프레임은 1단계에서 건수만 보여 주고 판정하지 않습니다(CRC 검사는 2단계).</p>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/report">다음: 3. 검증 보고서</a></div></section>';
    }
    return h;
  }
  function kv(k, v) { return '<div class="kv"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }

  function bindLog() {
    var file = document.getElementById('trcFile');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          log = { fileName: f.name, parsed: L.parseTrc(reader.result), sample: /^예시데이터/.test(f.name) };
          render();
          toast('로그를 읽었습니다: 데이터 프레임 ' + log.parsed.frames.length + '개');
        } catch (e) { toast('로그를 읽지 못했습니다: ' + e.message, true); }
      };
      reader.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
      reader.readAsText(f);
    });
  }

  // ── 3. 검증 보고서 ──────────────────────────────────
  var FILTERS = [
    { v: 'all', label: '전체' },
    { v: 'bad', label: '이상만' },
    { v: 'LOG_ONLY', label: 'ID 언매칭(로그에만 있음)' },
    { v: 'DBC_ONLY', label: 'ID 언매칭(로그에 없음)' },
    { v: 'PERIOD', label: '전송 주기 이탈' },
    { v: 'DLC', label: 'DLC 불일치' }
  ];
  function currentReport() {
    var bus = st.bus;
    if (bus !== '' && log.parsed.buses.indexOf(Number(bus)) < 0) bus = '';
    return L.analyze(st.messages, log.parsed.frames, { tolerancePct: st.tolerancePct, bus: bus });
  }
  function pageReport() {
    var h = '<div class="page-head"><h1>3. 검증 보고서</h1></div>';
    if (!st.messages.length || !log.parsed) {
      h += startCard() + '<div class="alert info">' +
        (!st.messages.length ? '<a href="#/dbc">1. DBC 기준표</a>를 먼저 만들어 주세요. ' : '') +
        (!log.parsed ? '<a href="#/log">2. TRC 로그</a>를 열어 주세요.' : '') + '</div>';
      return h;
    }
    var rep = currentReport(), s = rep.summary;
    var buses = log.parsed.buses;
    h += '<section class="card no-print"><h2>검사 설정</h2><form id="setForm" class="form-grid cols-3">' +
      '<label class="field"><span>전송 주기 허용 오차(%)</span><input type="number" name="tol" min="0" step="0.1" value="' + esc(st.tolerancePct) + '" required>' +
      '<small class="note">간격이 DBC 주기 ± 이 비율을 벗어나면 이탈로 셉니다. 처음 값 10%는 임시값이니 사내 기준으로 바꾸세요.</small></label>' +
      '<label class="field"><span>채널</span><select name="bus"' + (buses.length > 1 ? '' : ' disabled') + '><option value="">전체</option>' +
      buses.map(function (b) { return '<option value="' + b + '"' + (String(st.bus) === String(b) ? ' selected' : '') + '>' + b + '</option>'; }).join('') +
      '</select><small class="note">' + (buses.length > 1 ? '채널마다 DBC 가 다르면 채널을 골라 검사하세요.' : '로그에 채널이 하나뿐입니다.') + '</small></label>' +
      '<div class="field field-end"><button type="submit" class="btn btn-primary">다시 검사</button></div>' +
      '</form></section>';

    h += '<section class="card"><h2>요약</h2>' +
      '<dl class="kv-grid">' +
      kv('DBC', st.dbcFile + (st.dbcSample ? ' (예시)' : '')) + kv('로그', log.fileName + (log.sample ? ' (예시)' : '')) +
      kv('검사한 프레임', s.frameCount + '개') + kv('로그 구간(ms)', s.startT == null ? '-' : num(s.startT) + ' ~ ' + num(s.endT)) +
      kv('DBC 메시지', s.dbcCount + '개') + kv('로그에 나온 ID', s.logIdCount + '개') +
      kv('허용 오차', s.tolerancePct + '%') + kv('채널', s.bus == null ? '전체' : String(s.bus)) +
      '</dl><div class="stats">' +
      stat('ID 언매칭 — 로그에만 있음', s.logOnly, 'ID', s.logOnlyFrames + '프레임', 'LOG_ONLY') +
      stat('ID 언매칭 — 로그에 없음', s.dbcOnly, 'ID', 'DBC 에만 정의', 'DBC_ONLY') +
      stat('전송 주기 이탈', s.periodIds, 'ID', s.periodIntervals + '구간 · 검사 ' + s.periodChecked + 'ID', 'PERIOD') +
      stat('DLC 불일치', s.dlcIds, 'ID', s.dlcFrames + '프레임', 'DLC') +
      '</div>' +
      '<p class="note">이상 없는 ID ' + s.okIds + '개 · DBC 주기 없음(주기 검사 제외) ' + s.noPeriod + '개 · 프레임 1개(주기 판정 불가) ' + s.single + '개' +
      ' · 참고: 에러 프레임 ' + log.parsed.counts.error + '개(1단계는 판정하지 않음)</p>' +
      '<div class="btn-row no-print"><button type="button" class="btn btn-primary" data-act="exportReport">보고서 엑셀 내보내기</button>' +
      '<button type="button" class="btn" data-act="print">인쇄</button></div></section>';

    var rows = rep.rows.filter(function (r) {
      if (ui.filter === 'all') return true;
      if (ui.filter === 'bad') return r.issues.length > 0;
      return r.issues.indexOf(ui.filter) >= 0;
    });
    h += '<section class="card"><div class="page-head"><h2>ID별 상세</h2>' +
      '<label class="field inline no-print"><span>보기</span><select id="filterSel">' + FILTERS.map(function (f) {
        return '<option value="' + f.v + '"' + (ui.filter === f.v ? ' selected' : '') + '>' + esc(f.label) + '</option>';
      }).join('') + '</select></label></div>' +
      '<p class="note">지터 = 가장 긴 간격 − 가장 짧은 간격. 평균 주기 = (마지막 시각 − 첫 시각) ÷ (프레임 수 − 1).</p>' +
      '<div class="table-wrap"><table class="list"><thead><tr><th>메시지 ID</th><th>이름</th><th>송신 ECU</th><th>DBC 주기<small>ms</small></th><th>프레임</th>' +
      '<th>평균<small>ms</small></th><th>최소<small>ms</small></th><th>최대<small>ms</small></th><th>지터<small>ms</small></th><th>주기 이탈</th>' +
      '<th>DBC DLC</th><th>로그 DLC<small>길이(건수)</small></th><th>판정</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        var bad = r.issues.length > 0;
        return '<tr class="' + (bad ? 'row-bad' : '') + '"><td class="mono">' + esc(r.key) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.sender) + '</td>' +
          '<td>' + (r.dbcPeriod == null ? '' : esc(r.dbcPeriod)) + '</td><td>' + r.count + '</td><td>' + num(r.mean) + '</td><td>' + num(r.min) + '</td><td>' + num(r.max) + '</td><td>' + num(r.jitter) + '</td>' +
          '<td>' + (r.periodChecked ? (r.periodViolations ? '<strong class="bad">' + r.periodViolations + '</strong> (짧음 ' + r.shortCount + ' · 김 ' + r.longCount + ')' : '0') : '') + '</td>' +
          '<td>' + (r.dbcDlc == null ? '' : esc(r.dbcDlc)) + '</td><td>' + esc(L.dlcSeenText(r)) + '</td>' +
          '<td>' + (bad ? r.issues.map(function (c) { return '<span class="tag bad">' + esc(L.ISSUE_LABEL[c]) + '</span>'; }).join(' ') : '<span class="tag ok">정상</span>') +
          r.notes.map(function (n) { return ' <span class="tag note-tag">' + esc(L.NOTE_LABEL[n]) + '</span>'; }).join('') + '</td></tr>';
      }).join('') : '<tr><td colspan="13">해당하는 ID 가 없습니다.</td></tr>') +
      '</tbody></table></div></section>';

    var LIM = 300;
    h += '<section class="card"><h2>전송 주기 이탈 구간 — ' + rep.violations.length + '건</h2>';
    if (!rep.violations.length) h += '<p>허용 오차를 벗어난 간격이 없습니다.</p>';
    else {
      h += (rep.violations.length > LIM ? '<p class="note">화면에는 앞 ' + LIM + '건만 보입니다. 전체는 엑셀로 내보내세요.</p>' : '') +
        '<div class="table-wrap"><table class="list"><thead><tr><th>메시지 ID</th><th>이름</th><th>앞 프레임<small>ms</small></th><th>이 프레임<small>ms</small></th><th>간격<small>ms</small></th><th>DBC 주기<small>ms</small></th><th>구분</th><th>로그 줄</th></tr></thead><tbody>' +
        rep.violations.slice(0, LIM).map(function (v) {
          return '<tr><td class="mono">' + esc(v.key) + '</td><td>' + esc(v.name) + '</td><td>' + num(v.from) + '</td><td>' + num(v.to) + '</td><td><strong>' + num(v.interval) + '</strong></td><td>' + esc(v.period) +
            '</td><td>' + (v.kind === 'long' ? '김(늦음·누락 의심)' : '짧음(빠름)') + '</td><td>' + esc(v.line) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';
    return h;
  }
  function stat(label, n, unit, sub, filter) {
    return '<button type="button" class="stat' + (n ? ' has-bad' : '') + '" data-filter="' + filter + '"><span class="stat-label">' + esc(label) + '</span>' +
      '<span class="stat-num">' + n + '<small>' + esc(unit) + '</small></span><span class="stat-sub">' + esc(sub) + '</span></button>';
  }
  function bindReport() {
    var form = document.getElementById('setForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var tol = parseFloat(form.tol.value);
        if (!(tol >= 0)) { toast('허용 오차는 0 이상 숫자로 넣어 주세요.', true); return; }
        st.tolerancePct = tol; st.bus = form.bus.value; save();
        render(); toast('다시 검사했습니다.');
      });
    }
    var sel = document.getElementById('filterSel');
    if (sel) sel.addEventListener('change', function () { ui.filter = sel.value; render(); });
    Array.prototype.forEach.call(main.querySelectorAll('.stat'), function (b) {
      b.addEventListener('click', function () { ui.filter = b.getAttribute('data-filter'); render(); var s2 = document.getElementById('filterSel'); if (s2) s2.focus(); });
    });
  }
  function exportReport() {
    var rep = currentReport();
    var sheets = L.reportToSheets(rep, {
      createdAt: nowText(), dbcFile: st.dbcFile + (st.dbcSample ? ' (예시 데이터)' : ''), logFile: log.fileName + (log.sample ? ' (예시 데이터)' : ''),
      trcVersion: log.parsed.version, otherCounts: log.parsed.counts
    });
    sheets['DBC 기준표'] = L.messagesToSheet(st.messages);
    writeXlsx(sheets, (isSample() ? '예시데이터_' : '') + 'CAN검증보고서_' + stamp() + '.xlsx');
  }

  // ── 라우터 ──────────────────────────────────────────
  var PAGES = {
    '#/dbc': { page: pageDbc, bind: bindDbc },
    '#/log': { page: pageLog, bind: bindLog },
    '#/report': { page: pageReport, bind: bindReport }
  };
  function render() {
    var route = PAGES[location.hash] ? location.hash : '#/dbc';
    renderNav(route);
    main.innerHTML = PAGES[route].page();
    PAGES[route].bind();
    main.setAttribute('data-route', location.hash || '#/'); // 화면 전환 완료 표시(점검용)
  }
  main.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'sample') loadSample();
    else if (act === 'clear') clearAll();
    else if (act === 'print') window.print();
    else if (act === 'exportReport') exportReport();
    else if (act === 'exportDbc') writeXlsx({ 'DBC 기준표': L.messagesToSheet(st.messages) }, (st.dbcSample ? '예시데이터_' : '') + 'DBC기준표_' + stamp() + '.xlsx');
  });
  window.addEventListener('hashchange', function () { render(); main.focus(); });
  if (!Store.available()) toast('이 브라우저는 저장소를 쓸 수 없어, 창을 닫으면 기준표가 사라집니다.', true);
  render();
})();
