/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다.
   저장하는 것: DBC 기준표(메시지 목록)·파일 이름·검사 설정.
   TRC 로그는 크기가 커서 저장하지 않습니다(새로 열면 다시 선택). */
(function (root) {
  'use strict';
  var KEY = 'data09-13.state';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function defaults() {
    return { dbcFile: '', dbcSample: false, messages: [], idFormat: 'hex', tolerancePct: 10, bus: '' };
  }
  root.CanStore = {
    load: function () {
      var s = defaults();
      var raw = get(KEY);
      if (!raw) return s;
      try {
        var p = JSON.parse(raw);
        Object.keys(s).forEach(function (k) { if (p[k] !== undefined) s[k] = p[k]; });
        if (!Array.isArray(s.messages)) s.messages = [];
      } catch (e) { /* 깨진 값은 무시 */ }
      return s;
    },
    save: function (s) { set(KEY, JSON.stringify(s)); },
    clear: function () { del(KEY); },
    defaults: defaults,
    available: function () { get(KEY); return ok; }
  };
})(window);
