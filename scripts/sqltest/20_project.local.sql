-- ============================================================================
-- 로컬 검증 전용 — data09-13 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B·비로그인(anon) 세 역할로 번갈아 들어가
--  RLS 격리 · 기록성 표 · 제약 · 함수 권한을 실제로 확인한다.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 보조 함수 — 이름이 _assert 로 시작해 공통 권한 검사에서 제외된다.
-- 주어진 SQL 이 지정한 SQLSTATE 로 실패해야 통과.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state = p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

-- 주어진 DML 이 정확히 p_rows 행에 영향을 줘야 통과.
create or replace function public._assert_rows(p_sql text, p_rows int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, p_rows, p_label);
end;
$fn$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com')
on conflict (id) do nothing;

-- ── 재실행 안전 — run.sh 가 schema.sql 을 두 번 적용했다. 정책이 겹쳐 쌓이지 않았는가 ──
do $t$ begin raise notice '[프로젝트] 재적용 · 정책 수'; end $t$;
do $t$ begin
  perform public._assert_eq(
    (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    14, '두 번 적용해도 정책이 14개 그대로다');
  perform public._assert_eq(
    (select count(*)::int from pg_trigger where not tgisinternal
        and tgrelid in ('public.dbc_file'::regclass, 'public.dbc_message'::regclass,
                        'public.app_settings'::regclass)),
    3, '두 번 적용해도 updated_at 트리거가 3개 그대로다');
end $t$;

-- ── 사용자 A — 자기 자료 만들기 ──────────────────────────────
set role authenticated;
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;

do $t$ begin raise notice '[프로젝트] 사용자 A 입력 · 제약'; end $t$;
do $t$
declare v_file bigint; v_log bigint;
begin
  insert into public.dbc_file (file_name, is_sample) values ('예시데이터_DBC.xlsx', true)
  returning id into v_file;
  perform set_config('test.a_file', v_file::text, false);

  insert into public.dbc_message (dbc_file_id, can_id, id_key, name, period_ms, dlc, sender, row_no) values
    (v_file, 256,       '0x100',      'EX_ENG_STATUS', 10,   8, 'EX_EMS', 4),
    (v_file, 1280,      '0x500',      'EX_DIAG_REQ',   null, 8, 'EX_TESTER', 12),   -- 이벤트 메시지
    (v_file, 419369632, '0x18FF12A0', 'EX_EXT',        200,  8, 'EX_X', 13);         -- 29비트 확장 ID
  insert into public.app_settings (id_format, tolerance_pct, bus, current_dbc_id)
    values ('hex', 10, null, v_file);
  insert into public.verify_log (dbc_file_id, trc_file, tolerance_pct, dbc_count, log_id_count,
                                 frame_count, log_only, dbc_only, period_ids, dlc_ids, ok_ids)
    values (v_file, '예시데이터_로그.trc', 10, 8, 9, 1000, 2, 1, 2, 1, 3)
  returning id into v_log;
  perform set_config('test.a_log', v_log::text, false);

  perform public._assert_eq(
    (select owner_id from public.dbc_file where id = v_file),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'owner_id 가 auth.uid() 로 자동으로 채워진다');
  perform public._assert_eq((select count(*)::int from public.dbc_message), 3, 'A 는 자기 메시지 3건을 본다');

  -- 같은 기준표 안의 같은 ID 는 UNIQUE 가 막고, upsert 는 onConflict 로 갱신된다
  perform public._assert_raises(format(
    $q$insert into public.dbc_message (dbc_file_id, can_id, id_key) values (%s, 256, '0x100')$q$, v_file),
    '23505', '같은 기준표에 같은 CAN ID 두 줄은 UNIQUE 가 막는다');
  insert into public.dbc_message (dbc_file_id, can_id, id_key, period_ms) values (v_file, 256, '0x100', 20)
    on conflict (dbc_file_id, can_id) do update set period_ms = excluded.period_ms;
  perform public._assert_eq((select period_ms from public.dbc_message where can_id = 256),
    20::numeric, 'onConflict (dbc_file_id, can_id) upsert 가 갱신으로 동작한다');

  -- CHECK 제약
  perform public._assert_raises(format(
    $q$insert into public.dbc_message (dbc_file_id, can_id, id_key) values (%s, 536870912, 'x')$q$, v_file),
    '23514', 'CAN ID 는 0x1FFFFFFF 를 넘을 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.dbc_message (dbc_file_id, can_id, id_key, dlc) values (%s, 5, 'x', 65)$q$, v_file),
    '23514', 'DLC 는 0~64 범위만 받는다');
  perform public._assert_raises(format(
    $q$insert into public.dbc_message (dbc_file_id, can_id, id_key, period_ms) values (%s, 6, 'x', 0)$q$, v_file),
    '23514', '주기는 0 보다 커야 한다(비우면 null)');
  perform public._assert_raises(
    $q$update public.app_settings set id_format = 'oct'$q$,
    '23514', 'ID 표기는 hex/dec 만 받는다');
  perform public._assert_raises(
    $q$update public.app_settings set tolerance_pct = -1$q$,
    '23514', '허용 오차는 0 이상이다');
  perform public._assert_raises(
    $q$insert into public.dbc_file (file_name) values ('   ')$q$,
    '23514', '빈 파일 이름은 받지 않는다');

  -- updated_at 트리거
  update public.dbc_file set updated_at = '2000-01-01' where id = v_file;
  perform public._assert((select updated_at > '2001-01-01' from public.dbc_file where id = v_file),
    '수정하면 updated_at 트리거가 현재 시각으로 바꾼다');
end $t$;

-- 기록성 표 — 본인이라도 수정·삭제가 되지 않는다
do $t$ begin raise notice '[프로젝트] 기록성 표(verify_log)'; end $t$;
do $t$ begin
  perform public._assert_rows(
    'update public.verify_log set ok_ids = 999 where id = ' || current_setting('test.a_log'),
    0, 'verify_log 는 본인도 UPDATE 할 수 없다(0행)');
  perform public._assert_rows(
    'delete from public.verify_log where id = ' || current_setting('test.a_log'),
    0, 'verify_log 는 본인도 DELETE 할 수 없다(0행)');
  perform public._assert_eq((select ok_ids from public.verify_log
                              where id = current_setting('test.a_log')::bigint),
    3, 'verify_log 값이 그대로 남아 있다');
end $t$;

-- ── 사용자 B — A 의 자료를 보지도 고치지도 못한다 ─────────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false); end $t$;

do $t$ begin raise notice '[프로젝트] RLS — 사용자 B 는 A 의 자료에 손대지 못한다'; end $t$;
do $t$
declare v_file text := current_setting('test.a_file');
begin
  perform public._assert_eq((select count(*)::int from public.dbc_file),     0, 'B 에게 A 의 dbc_file 이 안 보인다');
  perform public._assert_eq((select count(*)::int from public.dbc_message),  0, 'B 에게 A 의 dbc_message 가 안 보인다');
  perform public._assert_eq((select count(*)::int from public.app_settings), 0, 'B 에게 A 의 app_settings 가 안 보인다');
  perform public._assert_eq((select count(*)::int from public.verify_log),   0, 'B 에게 A 의 verify_log 가 안 보인다');

  perform public._assert_rows('update public.dbc_file set file_name = $$탈취$$ where id = ' || v_file,
    0, 'B 는 A 의 dbc_file 을 고칠 수 없다(0행)');
  perform public._assert_rows('delete from public.dbc_message where dbc_file_id = ' || v_file,
    0, 'B 는 A 의 dbc_message 를 지울 수 없다(0행)');
  perform public._assert_rows('update public.app_settings set tolerance_pct = 99',
    0, 'B 는 A 의 app_settings 를 고칠 수 없다(0행)');

  perform public._assert_raises(
    $q$insert into public.dbc_file (owner_id, file_name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '위장')$q$,
    '42501', 'B 는 owner_id 를 A 로 위장해 넣을 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.dbc_message (dbc_file_id, can_id, id_key) values (%s, 7, '0x007')$q$, v_file),
    '42501', 'B 는 A 의 기준표에 메시지를 끼워 넣을 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.app_settings (current_dbc_id) values (%s)$q$, v_file),
    '42501', 'B 의 설정이 A 의 기준표를 가리킬 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.verify_log (dbc_file_id, tolerance_pct) values (%s, 10)$q$, v_file),
    '42501', 'B 의 검사 기록이 A 의 기준표를 가리킬 수 없다');

  -- B 도 자기 것은 정상적으로 만든다
  insert into public.dbc_file (file_name) values ('B.xlsx');
  perform public._assert_eq((select count(*)::int from public.dbc_file), 1, 'B 는 자기 dbc_file 만 본다');
end $t$;

-- ── 비로그인(anon) — 아무것도 보거나 쓰지 못한다 ─────────────────
reset role;
set role anon;
do $t$ begin perform set_config('request.jwt.claim.sub', '', false); end $t$;

do $t$ begin raise notice '[프로젝트] anon 차단'; end $t$;
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.dbc_file),     0, 'anon 에게 dbc_file 이 안 보인다');
  perform public._assert_eq((select count(*)::int from public.dbc_message),  0, 'anon 에게 dbc_message 가 안 보인다');
  perform public._assert_eq((select count(*)::int from public.app_settings), 0, 'anon 에게 app_settings 가 안 보인다');
  perform public._assert_eq((select count(*)::int from public.verify_log),   0, 'anon 에게 verify_log 가 안 보인다');
  perform public._assert_raises($q$insert into public.dbc_file (file_name) values ('익명')$q$,
    '42501', 'anon 은 dbc_file 을 쓸 수 없다');
  perform public._assert_raises($q$insert into public.verify_log (tolerance_pct) values (10)$q$,
    '42501', 'anon 은 verify_log 를 쓸 수 없다');
  perform public._assert_raises($q$insert into public.app_settings (id_format) values ('hex')$q$,
    '42501', 'anon 은 app_settings 를 쓸 수 없다');
  perform public._assert_raises($q$select public.set_updated_at()$q$,
    '42501', 'anon 은 set_updated_at() 을 실행할 수 없다');
end $t$;

reset role;

-- ── 함수 ACL — PUBLIC·anon EXECUTE 가 남지 않았는가 ────────────────
do $t$ begin raise notice '[프로젝트] 함수 ACL (proacl)'; end $t$;
do $t$
declare v_bad text;
begin
  -- 이 스키마에는 anon 예외 함수가 없다(RLS 정책 식에서 함수를 쓰지 않음)
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert(
    (select proacl is not null from pg_proc where proname = 'set_updated_at'),
    'set_updated_at 의 proacl 이 기본값(NULL=PUBLIC 실행)이 아니다');
  perform public._assert(
    (select bool_and(proconfig @> array['search_path=public'])
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수가 search_path = public 으로 고정돼 있다');
end $t$;

-- 정리
delete from public.verify_log;
delete from public.app_settings;
delete from public.dbc_file;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
