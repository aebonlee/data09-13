-- ============================================================================
-- data09-13 — CAN 로그 검증 도구 (DBC 기준표 × TRC 로그)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-13.state')에만 두는
--             DBC 기준표·검사 설정을 DB 로 옮길 때 쓸 테이블과 보안 정책입니다.
--             검사 실행 기록(verify_log)은 기획서 8장 3단계
--             「여러 시험 로그 일괄 검증·비교(시험 회차별 추이)」를 위한 표입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--  회사 공용 URL·키는 어디에도 들어 있지 않습니다.
--
--  테이블 (4개)
--    app_settings  — 사용자별 검사 설정 (ID 표기·허용 오차·채널, 현재 기준표)
--    dbc_file      — 올린 DBC 엑셀 한 벌 (파일 이름·예시 여부)
--    dbc_message   — DBC 기준표의 메시지 한 줄 (ID·이름·주기·DLC·송신 ECU)
--    verify_log    — 검사 실행 기록 (요약 수치) — 기록성, 수정·삭제 불가
--
--  TRC 로그 원본은 저장하지 않습니다. 크기가 크고 사내 기밀이라
--  지금처럼 브라우저 안에서만 읽고 계산합니다(기획서 7장).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- DBC 엑셀 한 벌. 지금 도구는 하나만 기억하지만(dbcFile·dbcSample),
-- DB 에서는 여러 벌을 쌓아 두고 비교할 수 있게 한다.
create table if not exists public.dbc_file (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  file_name   text not null check (length(btrim(file_name)) > 0),   -- dbcFile
  is_sample   boolean not null default false,                       -- dbcSample
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dbc_file_owner_idx on public.dbc_file (owner_id, created_at desc);

-- 메시지 기준표 (logic.js buildMessageTable 의 messages[] 한 항목)
--   id     → can_id  (정수. 11비트 표준 ~ 29비트 확장, 0 ~ 0x1FFFFFFF)
--   key    → id_key  ('0x1A0' 같은 표시용 문자열)
--   name / period / dlc / sender / row → name / period_ms / dlc / sender / row_no
create table if not exists public.dbc_message (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  dbc_file_id  bigint not null references public.dbc_file(id) on delete cascade,
  can_id       bigint not null check (can_id between 0 and 536870911),  -- 0x1FFFFFFF
  id_key       text not null,
  name         text not null default '',
  period_ms    numeric check (period_ms is null or period_ms > 0),       -- 비어 있으면 이벤트 메시지(주기 검사 제외)
  dlc          smallint check (dlc is null or dlc between 0 and 64),     -- CAN FD 까지 64바이트
  sender       text not null default '',
  row_no       int check (row_no is null or row_no > 0),                 -- 엑셀 원본 행 번호
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 한 기준표 안에서 같은 ID 는 한 줄. 도구도 같은 ID 를 한 줄로 합친다.
  -- ⚠ 프런트에서 upsert 할 때 onConflict: 'dbc_file_id,can_id' 를 반드시 지정할 것.
  constraint dbc_message_file_can_key unique (dbc_file_id, can_id)
);
create index if not exists dbc_message_owner_idx on public.dbc_message (owner_id);

-- 검사 설정 (store.js defaults 의 idFormat·tolerancePct·bus) — 사용자당 한 행
create table if not exists public.app_settings (
  owner_id        uuid primary key default auth.uid(),
  id_format       text not null default 'hex' check (id_format in ('hex', 'dec')),
  tolerance_pct   numeric not null default 10 check (tolerance_pct >= 0),
  bus             int check (bus is null or bus >= 0),                   -- null = 전체 채널
  current_dbc_id  bigint references public.dbc_file(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 검사 실행 기록 (logic.js analyze() 의 summary). 기록성이라 UPDATE/DELETE 정책이 없다.
create table if not exists public.verify_log (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  dbc_file_id     bigint references public.dbc_file(id) on delete set null,
  trc_file        text not null default '',
  tolerance_pct   numeric not null check (tolerance_pct >= 0),
  bus             int check (bus is null or bus >= 0),
  dbc_count       int not null default 0 check (dbc_count >= 0),
  log_id_count    int not null default 0 check (log_id_count >= 0),
  frame_count     int not null default 0 check (frame_count >= 0),
  log_only        int not null default 0 check (log_only >= 0),     -- ID 언매칭(로그에만 있음)
  dbc_only        int not null default 0 check (dbc_only >= 0),     -- ID 언매칭(로그에 없음)
  period_ids      int not null default 0 check (period_ids >= 0),   -- 전송 주기 이탈 ID 수
  period_intervals int not null default 0 check (period_intervals >= 0),
  dlc_ids         int not null default 0 check (dlc_ids >= 0),      -- DLC 불일치 ID 수
  ok_ids          int not null default 0 check (ok_ids >= 0),
  ran_at          timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists verify_log_owner_idx on public.verify_log (owner_id, ran_at desc);

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 를 고정한다(호출자 search_path 로 엉뚱한 객체를 잡지 않게)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists dbc_file_updated_at on public.dbc_file;
create trigger dbc_file_updated_at before update on public.dbc_file
  for each row execute function public.set_updated_at();

drop trigger if exists dbc_message_updated_at on public.dbc_message;
create trigger dbc_message_updated_at before update on public.dbc_message
  for each row execute function public.set_updated_at();

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS — 행은 만든 사람(owner_id)만 보고 고친다. 비로그인(anon)은 아무것도 못 한다.
-- ----------------------------------------------------------------------------

alter table public.dbc_file     enable row level security;
alter table public.dbc_message  enable row level security;
alter table public.app_settings enable row level security;
alter table public.verify_log   enable row level security;

-- dbc_file / app_settings : 본인 행만 읽기·쓰기·수정·삭제
do $rls$
declare t text;
begin
  foreach t in array array['dbc_file', 'app_settings']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- app_settings : 현재 기준표(current_dbc_id)로 남의 기준표를 가리키지 못하게 쓰기 정책을 좁힌다
drop policy if exists app_settings_insert on public.app_settings;
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check (owner_id = auth.uid()
              and (current_dbc_id is null
                   or exists (select 1 from public.dbc_file f
                               where f.id = current_dbc_id and f.owner_id = auth.uid())));
create policy app_settings_update on public.app_settings for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and (current_dbc_id is null
                   or exists (select 1 from public.dbc_file f
                               where f.id = current_dbc_id and f.owner_id = auth.uid())));

-- dbc_message : 본인 행이면서, 붙는 기준표(dbc_file)도 본인 것이어야 한다.
-- 남의 기준표 id 를 넣어 끼워 넣는 것을 막는다.
drop policy if exists dbc_message_select on public.dbc_message;
drop policy if exists dbc_message_insert on public.dbc_message;
drop policy if exists dbc_message_update on public.dbc_message;
drop policy if exists dbc_message_delete on public.dbc_message;
create policy dbc_message_select on public.dbc_message for select to authenticated
  using (owner_id = auth.uid());
create policy dbc_message_insert on public.dbc_message for insert to authenticated
  with check (owner_id = auth.uid()
              and exists (select 1 from public.dbc_file f
                           where f.id = dbc_file_id and f.owner_id = auth.uid()));
create policy dbc_message_update on public.dbc_message for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.dbc_file f
                           where f.id = dbc_file_id and f.owner_id = auth.uid()));
create policy dbc_message_delete on public.dbc_message for delete to authenticated
  using (owner_id = auth.uid());

-- verify_log : 기록성 — 읽기·추가만. 수정·삭제 정책을 두지 않아 사후 조작을 막는다.
drop policy if exists verify_log_select on public.verify_log;
drop policy if exists verify_log_insert on public.verify_log;
create policy verify_log_select on public.verify_log for select to authenticated
  using (owner_id = auth.uid());
create policy verify_log_insert on public.verify_log for insert to authenticated
  with check (owner_id = auth.uid()
              and (dbc_file_id is null
                   or exists (select 1 from public.dbc_file f
                               where f.id = dbc_file_id and f.owner_id = auth.uid())));

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 신규 함수마다 anon·authenticated·service_role 에 자동 부여
--  그래서 PUBLIC 과 anon 을 둘 다 끊고 authenticated 에만 다시 준다.
--  (이 스키마에는 RLS 정책 식에서 쓰는 함수가 없으므로 anon 예외도 없다)
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수. 트리거 발화 시 호출자 EXECUTE 를 검사할 경우를 대비해 남긴다.
-- 직접 호출하면 "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
