-- Задания для учеников: таблицы assignments и attempts и две функции для учеников без входа.
-- Запускайте ПОСЛЕ schema.sql: Supabase → SQL Editor → New query → вставить этот файл → Run.
-- Скрипт можно запускать повторно: он не удаляет данные.
--
-- Как это работает:
-- * Учитель (вошёл в аккаунт) создаёт задание: квиз, карточки или конспект. Содержимое
--   хранится в payload, поэтому ученик никогда не вызывает ИИ.
-- * Ученик НЕ входит в аккаунт. У роли anon нет доступа к таблицам вообще.
--   Ученик может только вызвать две узкие функции: get_assignment_by_code и submit_attempt.
-- * anon-ключ публичный (его видит браузер), поэтому функции можно вызвать и в обход нашего
--   сервера. Значит, все важные проверки (задание открыто, лимит попыток, длина имени,
--   правильность ответов, подсчёт баллов) сделаны ЗДЕСЬ, а не только на сервере.

-- ========== Задания ==========
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Случайный код для ссылки (secrets.token_urlsafe(16) = 22 символа)
  code        text not null unique check (code ~ '^[A-Za-z0-9_-]{16,64}$'),
  type        text not null check (type in ('quiz', 'flashcards', 'summary')),
  title       text not null default '' check (char_length(title) <= 200),
  -- Язык, на котором ИИ составил содержимое ('' = не указан). Содержимое показывается как есть.
  content_lang text not null default '' check (content_lang in ('', 'ru', 'kk', 'en')),
  payload     jsonb not null check (jsonb_typeof(payload) = 'object'
                                    and char_length(payload::text) <= 200000),
  is_open     boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Если таблицу создали более ранней версией этого файла — добавить колонку языка
alter table public.assignments add column if not exists content_lang text not null default ''
  check (content_lang in ('', 'ru', 'kk', 'en'));

-- unique уже создаёт индекс по code; этот индекс — для списка «Мои задания»
create index if not exists assignments_teacher_created_idx on public.assignments (teacher_id, created_at desc);

-- ========== Попытки учеников ==========
create table if not exists public.attempts (
  id                uuid primary key default gen_random_uuid(),
  assignment_id     uuid not null references public.assignments (id) on delete cascade,
  student_name      text not null check (char_length(student_name) between 1 and 40),
  answers           jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  score             int  check (score >= 0),
  total             int  check (total >= 0 and (score is null or score <= total)),
  duration_seconds  int  check (duration_seconds between 0 and 86400),
  completed         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists attempts_assignment_created_idx on public.attempts (assignment_id, created_at desc);
create index if not exists attempts_created_idx on public.attempts (created_at);

-- ========== Row Level Security ==========
alter table public.assignments enable row level security;
alter table public.attempts    enable row level security;

-- Задания: учитель видит и меняет только свои
drop policy if exists "assignments_select_own" on public.assignments;
drop policy if exists "assignments_insert_own" on public.assignments;
drop policy if exists "assignments_update_own" on public.assignments;
drop policy if exists "assignments_delete_own" on public.assignments;
create policy "assignments_select_own" on public.assignments for select to authenticated
  using (teacher_id = (select auth.uid()));
create policy "assignments_insert_own" on public.assignments for insert to authenticated
  with check (teacher_id = (select auth.uid()));
create policy "assignments_update_own" on public.assignments for update to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "assignments_delete_own" on public.assignments for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- Попытки: учитель может читать и удалять попытки только своих заданий.
-- Вставлять попытки может только функция submit_attempt (ниже), менять — никто.
drop policy if exists "attempts_select_own" on public.attempts;
drop policy if exists "attempts_delete_own" on public.attempts;
create policy "attempts_select_own" on public.attempts for select to authenticated
  using (exists (select 1 from public.assignments a
                 where a.id = assignment_id and a.teacher_id = (select auth.uid())));
create policy "attempts_delete_own" on public.attempts for delete to authenticated
  using (exists (select 1 from public.assignments a
                 where a.id = assignment_id and a.teacher_id = (select auth.uid())));

-- ========== Права доступа ==========
-- anon (ученики, любой человек с публичным ключом): к таблицам доступа НЕТ совсем
revoke all on public.assignments, public.attempts from anon;
revoke all on public.assignments, public.attempts from authenticated;
grant select, insert, delete on public.assignments to authenticated;
-- Менять можно только название и «открыто/закрыто». Код и содержимое после публикации не меняются.
grant update (is_open, title) on public.assignments to authenticated;
grant select, delete on public.attempts to authenticated;

-- ========== Функция для ученика: получить задание по коду ==========
-- Возвращает {type, title, content_lang, payload} только для ОТКРЫТОГО задания. Иначе null —
-- одинаково для «нет такого кода» и «закрыто», чтобы по ответу нельзя было подбирать коды.
create or replace function public.get_assignment_by_code(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('type', a.type, 'title', a.title, 'content_lang', a.content_lang,
                            'payload', a.payload)
  from public.assignments a
  where p_code ~ '^[A-Za-z0-9_-]{16,64}$'
    and a.code = p_code
    and a.is_open
$$;

-- ========== Функция для ученика: сдать попытку ==========
-- Проверяет всё сама и сама считает баллы (баллам от браузера не доверяем).
-- Ответы (p_answers):
--   квиз:     {"choices": [номер варианта или null, ...]} — по одному на вопрос
--   карточки: {"known": [номера карточек], "repeat": [номера карточек]} — каждая карточка ровно один раз
--   конспект: {"read": true}
-- Ошибки (их понимает сервер): assignment_unavailable, attempts_limit, invalid_name, invalid_answers.
create or replace function public.submit_attempt(
  p_code text, p_name text, p_answers jsonb, p_duration int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Лимит попыток на одно задание. Должен совпадать с MAX_ATTEMPTS_PER_ASSIGNMENT в Backend/config.py
  max_attempts constant int := 500;
  a            public.assignments%rowtype;
  v_name       text;
  v_items      jsonb;
  v_choices    jsonb;
  v_choice     jsonb;
  v_known      jsonb;
  v_repeat     jsonb;
  v_total      int;
  v_score      int;
  v_completed  boolean := true;
  v_answers    jsonb;
  v_all        int;
  v_distinct   int;
  v_ok         boolean;
  i            int;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'assignment_unavailable';
  end if;

  -- Имя: убираем лишние пробелы, длина 1–40
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;

  -- for update: две одновременные попытки не обойдут лимит
  select * into a from public.assignments
  where code = p_code and is_open
  for update;
  if not found then
    raise exception 'assignment_unavailable';
  end if;

  if (select count(*) from public.attempts where assignment_id = a.id) >= max_attempts then
    raise exception 'attempts_limit';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'invalid_answers';
  end if;

  if a.type = 'quiz' then
    v_items := a.payload -> 'questions';
    v_total := case when jsonb_typeof(v_items) = 'array' then jsonb_array_length(v_items) end;
    if coalesce(v_total, 0) = 0 then
      raise exception 'invalid_answers';  -- содержимое задания повреждено
    end if;
    v_choices := p_answers -> 'choices';
    if jsonb_typeof(v_choices) is distinct from 'array' or jsonb_array_length(v_choices) <> v_total then
      raise exception 'invalid_answers';
    end if;
    v_score := 0;
    for i in 0 .. v_total - 1 loop
      v_choice := v_choices -> i;
      if jsonb_typeof(v_choice) = 'null' then
        v_completed := false;  -- вопрос пропущен
        continue;
      end if;
      -- Только целое число 0..99 и только среди вариантов этого вопроса
      if jsonb_typeof(v_choice) <> 'number' or v_choice::text !~ '^[0-9]{1,2}$'
         or (v_choice::text)::int >= jsonb_array_length(v_items -> i -> 'options') then
        raise exception 'invalid_answers';
      end if;
      if (v_choice::text)::int = (v_items -> i ->> 'correct_index')::int then
        v_score := v_score + 1;
      end if;
    end loop;
    v_answers := jsonb_build_object('choices', v_choices);

  elsif a.type = 'flashcards' then
    v_total := case when jsonb_typeof(a.payload -> 'cards') = 'array'
                    then jsonb_array_length(a.payload -> 'cards') end;
    if coalesce(v_total, 0) = 0 then
      raise exception 'invalid_answers';  -- содержимое задания повреждено
    end if;
    v_known := p_answers -> 'known';
    v_repeat := p_answers -> 'repeat';
    if jsonb_typeof(v_known) is distinct from 'array' or jsonb_typeof(v_repeat) is distinct from 'array' then
      raise exception 'invalid_answers';
    end if;
    -- Каждая карточка ровно один раз: всего v_total номеров, все разные, все в диапазоне
    select count(*), count(distinct e.v),
           coalesce(bool_and(case
             when jsonb_typeof(e.v) = 'number' and e.v::text ~ '^[0-9]{1,3}$'
               then (e.v::text)::int < v_total
             else false end), true)
      into v_all, v_distinct, v_ok
      from (select value as v from jsonb_array_elements(v_known)
            union all
            select value from jsonb_array_elements(v_repeat)) e;
    if not v_ok or v_all <> v_total or v_distinct <> v_total then
      raise exception 'invalid_answers';
    end if;
    v_score := jsonb_array_length(v_known);
    v_answers := jsonb_build_object('known', v_known, 'repeat', v_repeat);

  else  -- summary
    if (p_answers -> 'read') is distinct from 'true'::jsonb then
      raise exception 'invalid_answers';
    end if;
    v_score := null;
    v_total := null;
    v_answers := '{"read": true}'::jsonb;
  end if;

  insert into public.attempts (assignment_id, student_name, answers, score, total, duration_seconds, completed)
  values (a.id, v_name, v_answers, v_score, v_total,
          case when p_duration is null then null else least(greatest(p_duration, 0), 86400) end,
          v_completed);

  return jsonb_build_object('score', v_score, 'total', v_total, 'completed', v_completed);
end;
$$;

-- Функции может вызывать anon (ученик без входа) и authenticated (учитель проверяет свою ссылку)
revoke all on function public.get_assignment_by_code(text) from public;
revoke all on function public.submit_attempt(text, text, jsonb, int) from public;
grant execute on function public.get_assignment_by_code(text) to anon, authenticated;
grant execute on function public.submit_attempt(text, text, jsonb, int) to anon, authenticated;

-- ========== Необязательно: автоудаление старых попыток по расписанию ==========
-- Сервер и так удаляет попытки старше ATTEMPT_RETENTION_DAYS (config.py), когда учитель
-- открывает «Мои задания». Если хотите удалять их и без этого, включите расширение pg_cron
-- (Database → Extensions) и выполните отдельно:
--
-- select cron.schedule('delete-old-attempts', '0 3 * * *',
--   $$delete from public.attempts where created_at < now() - interval '180 days'$$);

-- Попросить REST API Supabase сразу увидеть новые таблицы и функции
notify pgrst, 'reload schema';
