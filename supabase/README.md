# Supabase DB 스크립트 — CAN 로그 검증 도구

이 폴더에는 CAN 로그 검증 도구의 자료를 데이터베이스(Supabase)에 저장할 때 쓰는 SQL 스크립트가 들어 있습니다.
지금 도구는 이 스크립트 없이도 그대로 동작합니다.
앱을 DB 에 연결하는 일은 다음 단계에서 진행합니다.

## 왜 DB 가 필요한가

지금 도구는 DBC 기준표와 검사 설정을 브라우저 저장소(localStorage)에만 둡니다.
이 방식에는 다음과 같은 한계가 있습니다.

- **기준표가 한 벌만 남습니다.** 새 DBC 엑셀을 올리면 이전 기준표가 사라집니다. 차종·사양별로 기준표를 여러 벌 두고 골라 쓸 수 없습니다.
- **다른 PC·다른 브라우저에서는 처음부터 다시 올려야 합니다.** 시험실 PC 에서 만든 기준표를 사무실 PC 에서 볼 수 없습니다.
- **검사 결과가 남지 않습니다.** 기획서 8장 3단계의 「여러 시험 로그 일괄 검증·비교(시험 회차별 추이)」를 하려면 회차마다 검사 요약을 쌓아 두어야 합니다.
- **브라우저 기록을 지우면 기준표도 함께 지워집니다.**

TRC 로그 원본은 DB 에 넣지 않습니다.
크기가 크고 사내 기밀이라 지금처럼 브라우저 안에서만 읽고 계산합니다.
DB 에는 기준표와 검사 요약 수치만 저장합니다.

## 테이블

| 테이블 | 용도 | localStorage 대응 (`data09-13.state`) |
|---|---|---|
| `dbc_file` | 올린 DBC 엑셀 한 벌(파일 이름, 예시 여부) | `dbcFile`, `dbcSample` |
| `dbc_message` | 기준표의 메시지 한 줄(CAN ID, 이름, 주기, DLC, 송신 ECU, 엑셀 행 번호) | `messages[]` 의 `id`·`key`·`name`·`period`·`dlc`·`sender`·`row` |
| `app_settings` | 사용자별 검사 설정(ID 표기, 허용 오차, 채널, 현재 기준표) | `idFormat`, `tolerancePct`, `bus` |
| `verify_log` | 검사 실행 기록(언매칭·주기 이탈·DLC 불일치 건수 등 요약) | 없음(새로 추가, 3단계 회차별 추이용) |

지켜지는 규칙은 다음과 같습니다.

- CAN ID 는 0 ~ 0x1FFFFFFF(29비트 확장 ID 까지), DLC 는 0 ~ 64, 주기는 0 보다 큰 값이거나 비어 있어야 합니다.
- 한 기준표 안에서 같은 CAN ID 는 한 줄만 들어갑니다(`dbc_file_id, can_id` UNIQUE). 앱에서 upsert 할 때 `onConflict: 'dbc_file_id,can_id'` 를 지정해야 합니다.
- ID 표기는 `hex`·`dec` 두 가지만, 허용 오차는 0 이상만 받습니다.

## 보안

- 모든 테이블에 행 수준 보안(RLS)이 켜져 있습니다.
- 각 행은 만든 사람(`owner_id`)만 보고 고칠 수 있습니다. `owner_id` 는 로그인한 사용자로 자동으로 채워집니다.
- 남의 기준표에 메시지를 끼워 넣거나, 설정·검사 기록이 남의 기준표를 가리키게 할 수 없습니다.
- 로그인하지 않은 방문자(anon)는 아무것도 보거나 쓸 수 없습니다.
- `verify_log` 는 기록용이라 본인도 수정·삭제할 수 없습니다(추가·조회만 가능).
- 함수는 `search_path` 를 고정했고, 실행 권한을 로그인 사용자에게만 줍니다.

## 적용 방법

1. <https://supabase.com> 에 가입합니다.
2. 새 프로젝트(New project)를 만듭니다. 본인 계정의 본인 프로젝트에 적용합니다.
3. 왼쪽 메뉴에서 SQL Editor 를 엽니다.
4. `supabase/schema.sql` 파일 내용을 전부 복사해 붙여 넣습니다.
5. Run 을 눌러 실행합니다.

여러 번 실행해도 안전합니다. 이미 있는 테이블·정책은 건너뛰거나 새로 고쳐 만듭니다.

## 확인 방법

- Table Editor 에 `dbc_file`, `dbc_message`, `app_settings`, `verify_log` 네 테이블이 보이면 됩니다.
- Authentication → Policies 에서 네 테이블 모두 RLS 가 켜져 있고 정책이 붙어 있는지 확인합니다.
- SQL Editor 에서 다음을 실행하면 정책 14개가 나와야 합니다.

  ```sql
  select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;
  ```

## 앱 연결은 다음 단계입니다

이번에는 스크립트만 저장했습니다.
도구의 `js/store.js` 는 아직 localStorage 를 씁니다.
연결할 때는 본인 프로젝트의 URL 과 anon 키를 받아 로그인 기능과 함께 붙입니다.

## 로컬 검증 방법

운영 DB 에 올리기 전에 내 컴퓨터의 임시 PostgreSQL 에서 스크립트를 실제로 적용해 확인할 수 있습니다.

```sh
./scripts/sqltest/run.sh
```

- PostgreSQL 16·17 이 필요합니다(macOS: `brew install postgresql@17`).
- 임시 데이터베이스를 만들어 쓰고 끝나면 지우므로 기존 설치에 영향이 없습니다.
- 스키마를 두 번 적용해 재실행 안전성을 보고, 사용자 A·B·비로그인 세 역할로 RLS 격리·기록성 표·제약·함수 권한을 확인합니다.
- 마지막에 「SQL 검증 통과.」가 나오면 성공입니다.
- `scripts/sqltest/*.local.sql` 은 로컬 검증 전용입니다. Supabase SQL Editor 에서 실행하면 스스로 멈추도록 가드가 들어 있습니다.
