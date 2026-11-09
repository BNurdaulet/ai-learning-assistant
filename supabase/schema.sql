-- Схема базы для ИИ-помощника. Запустите целиком в Supabase: SQL Editor → New query → Run.
-- Скрипт можно запускать повторно: он не удаляет данные.
-- Каждая таблица защищена Row Level Security: пользователь видит и меняет только свои строки.

-- ========== Квизы ==========
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic       text not null default '' check (char_length(topic) <= 200),
  difficulty  text not null default '' check (char_length(difficulty) <= 30),
  questions   jsonb not null check (jsonb_typeof(questions) = 'array'),
  created_at  timestamptz not null default now()
);
create index if not exists quizzes_user_created_idx on public.quizzes (user_id, created_at desc);

-- ========== Результаты квизов ==========
create table if not exists public.quiz_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quiz_id     uuid references public.quizzes (id) on delete set null,  -- пусто, если квиз не сохранён
  topic       text not null default '' check (char_length(topic) <= 200),
  score       int  not null check (score >= 0),
  total       int  not null check (total > 0 and score <= total),
  mistakes    jsonb not null default '[]' check (jsonb_typeof(mistakes) = 'array'),
  created_at  timestamptz not null default now()
);
create index if not exists quiz_results_user_created_idx on public.quiz_results (user_id, created_at desc);
create index if not exists quiz_results_quiz_idx on public.quiz_results (quiz_id);

-- ========== Чаты ==========
create table if not exists public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'Новый чат' check (char_length(title) <= 100),
  style       text not null default 'tutor' check (style in ('tutor', 'simple', 'strict')),
  created_at  timestamptz not null default now()
);
create index if not exists chat_sessions_user_created_idx on public.chat_sessions (user_id, created_at desc);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 20000),
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists chat_messages_session_created_idx on public.chat_messages (session_id, created_at);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id);

-- ========== Дневной счётчик запросов к ИИ ==========
create table if not exists public.ai_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null default current_date,
  count    int  not null default 0,
  primary key (user_id, day)
);

-- ========== Row Level Security ==========
alter table public.quizzes       enable row level security;
alter table public.quiz_results  enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_usage      enable row level security;

-- Квизы: только свои
drop policy if exists "quizzes_select_own" on public.quizzes;
drop policy if exists "quizzes_insert_own" on public.quizzes;
drop policy if exists "quizzes_update_own" on public.quizzes;
drop policy if exists "quizzes_delete_own" on public.quizzes;
create policy "quizzes_select_own" on public.quizzes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "quizzes_insert_own" on public.quizzes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "quizzes_update_own" on public.quizzes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "quizzes_delete_own" on public.quizzes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Результаты: только свои; ссылаться можно только на свой квиз
drop policy if exists "results_select_own" on public.quiz_results;
drop policy if exists "results_insert_own" on public.quiz_results;
drop policy if exists "results_update_own" on public.quiz_results;
drop policy if exists "results_delete_own" on public.quiz_results;
create policy "results_select_own" on public.quiz_results for select to authenticated
  using (user_id = (select auth.uid()));
create policy "results_insert_own" on public.quiz_results for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (quiz_id is null or exists (
      select 1 from public.quizzes q where q.id = quiz_id and q.user_id = (select auth.uid())))
  );
create policy "results_update_own" on public.quiz_results for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (quiz_id is null or exists (
      select 1 from public.quizzes q where q.id = quiz_id and q.user_id = (select auth.uid())))
  );
create policy "results_delete_own" on public.quiz_results for delete to authenticated
  using (user_id = (select auth.uid()));

-- Сессии чата: только свои
drop policy if exists "sessions_select_own" on public.chat_sessions;
drop policy if exists "sessions_insert_own" on public.chat_sessions;
drop policy if exists "sessions_update_own" on public.chat_sessions;
drop policy if exists "sessions_delete_own" on public.chat_sessions;
create policy "sessions_select_own" on public.chat_sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "sessions_insert_own" on public.chat_sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "sessions_update_own" on public.chat_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sessions_delete_own" on public.chat_sessions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Сообщения: только свои и только в своей сессии
drop policy if exists "messages_select_own" on public.chat_messages;
drop policy if exists "messages_insert_own" on public.chat_messages;
drop policy if exists "messages_update_own" on public.chat_messages;
drop policy if exists "messages_delete_own" on public.chat_messages;
create policy "messages_select_own" on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "messages_insert_own" on public.chat_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.chat_sessions s
                where s.id = session_id and s.user_id = (select auth.uid()))
  );
create policy "messages_update_own" on public.chat_messages for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.chat_sessions s
                where s.id = session_id and s.user_id = (select auth.uid()))
  );
create policy "messages_delete_own" on public.chat_messages for delete to authenticated
  using (user_id = (select auth.uid()));

-- Счётчик: пользователь может только читать свою строку и удалять свои строки.
-- Увеличить счётчик можно только функцией bump_ai_usage (ниже), поэтому сбросить его нельзя.
drop policy if exists "usage_select_own" on public.ai_usage;
drop policy if exists "usage_delete_own" on public.ai_usage;
create policy "usage_select_own" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));
create policy "usage_delete_own" on public.ai_usage for delete to authenticated
  using (user_id = (select auth.uid()) and day < current_date);  -- сегодняшнюю строку удалить нельзя

-- ========== Права доступа (без них запросы падают ещё до проверки RLS) ==========
revoke all on public.quizzes, public.quiz_results, public.chat_sessions,
              public.chat_messages, public.ai_usage from anon;
grant select, insert, update, delete on public.quizzes, public.quiz_results,
      public.chat_sessions, public.chat_messages to authenticated;
revoke insert, update on public.ai_usage from authenticated;
grant select, delete on public.ai_usage to authenticated;

-- ========== Функция: +1 запрос к ИИ за сегодня, возвращает новое значение ==========
create or replace function public.bump_ai_usage()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.ai_usage (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into result;
  return result;
end;
$$;

revoke all on function public.bump_ai_usage() from public, anon;
grant execute on function public.bump_ai_usage() to authenticated;

-- Попросить REST API Supabase сразу увидеть новые таблицы и функцию
notify pgrst, 'reload schema';
