-- Статистика фокуса: завершённые рабочие сессии таймера Помодоро.
-- Запускайте ПОСЛЕ schema.sql: Supabase → SQL Editor → New query → вставить этот файл → Run.
-- Скрипт можно запускать повторно: он не удаляет данные.
--
-- * Одна строка = одна завершённая сессия работы (минуты и местная дата пользователя).
-- * client_id — стабильный id сессии из браузера: повторная отправка не создаёт дубль
--   (unique + вставка с ignore-duplicates).
-- * anon-ключ публичный, поэтому пользователь может писать в таблицу и в обход нашего сервера.
--   Значит, важные проверки — ЗДЕСЬ: только свои строки (RLS), минуты 1–120,
--   дата не дальше ±2 дней от сегодняшней, не больше 48 сессий за день.

create table if not exists public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id   uuid not null,
  day         date not null,                                  -- местная дата пользователя
  minutes     smallint not null check (minutes between 1 and 120),
  created_at  timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists focus_sessions_user_day_idx on public.focus_sessions (user_id, day);

alter table public.focus_sessions enable row level security;

drop policy if exists "focus_select_own" on public.focus_sessions;
drop policy if exists "focus_insert_own" on public.focus_sessions;
drop policy if exists "focus_delete_own" on public.focus_sessions;

create policy "focus_select_own" on public.focus_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- Вставка: только себе, дата рядом с сегодняшней (часовые пояса до ±14 ч), лимит сессий за день.
create policy "focus_insert_own" on public.focus_sessions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and day between current_date - 2 and current_date + 2
    and (select count(*) from public.focus_sessions f
         where f.user_id = (select auth.uid()) and f.day = focus_sessions.day) < 48
  );

create policy "focus_delete_own" on public.focus_sessions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Менять старые сессии нельзя (нет update): статистику можно только дополнять или удалить
revoke all on public.focus_sessions from anon;
revoke update on public.focus_sessions from authenticated;
grant select, insert, delete on public.focus_sessions to authenticated;

notify pgrst, 'reload schema';
