-- Большие документы: таблицы documents и chunks и функция поиска search_chunks.
-- Запускайте ПОСЛЕ schema.sql: Supabase → SQL Editor → New query → вставить этот файл → Run.
-- Скрипт можно запускать повторно: он не удаляет данные.
--
-- Как это работает: текст документа режется на части (chunks) примерно по 1500 символов.
-- Для каждой части Postgres сам строит поисковый индекс (колонка fts) на русском и английском,
-- поэтому «клетки» находит «клетка». Чат и квиз берут только подходящие части, а не весь файл.

-- ========== Документы ==========
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null default '' check (char_length(title) <= 200),
  filename     text not null default '' check (char_length(filename) <= 255),
  pages        int  not null default 0 check (pages >= 0),
  chars        int  not null default 0 check (chars >= 0),
  chunk_count  int  not null default 0 check (chunk_count >= 0),  -- 0 = загрузка не закончилась
  created_at   timestamptz not null default now()
);
create index if not exists documents_user_created_idx on public.documents (user_id, created_at desc);

-- ========== Части документов ==========
create table if not exists public.chunks (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.documents (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  idx          int  not null check (idx >= 0 and idx < 3000),          -- номер части в документе
  page_start   int  not null check (page_start >= 1),
  page_end     int  not null check (page_end >= page_start),
  content      text not null check (char_length(content) between 1 and 4000),
  -- Поисковый индекс: строится автоматически из content (русские и английские словоформы)
  fts          tsvector generated always as (
                 to_tsvector('russian', content) || to_tsvector('english', content)
               ) stored,
  unique (document_id, idx)
);
create index if not exists chunks_fts_idx on public.chunks using gin (fts);
create index if not exists chunks_user_idx on public.chunks (user_id);
create index if not exists chunks_document_pages_idx on public.chunks (document_id, page_start, page_end);

-- ========== Row Level Security ==========
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_select_own" on public.documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "documents_insert_own" on public.documents for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "documents_update_own" on public.documents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "documents_delete_own" on public.documents for delete to authenticated
  using (user_id = (select auth.uid()));

-- Части: только свои и только в своём документе. Менять части нельзя (только добавить или удалить).
drop policy if exists "chunks_select_own" on public.chunks;
drop policy if exists "chunks_insert_own" on public.chunks;
drop policy if exists "chunks_delete_own" on public.chunks;
create policy "chunks_select_own" on public.chunks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "chunks_insert_own" on public.chunks for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.documents d
                where d.id = document_id and d.user_id = (select auth.uid()))
  );
create policy "chunks_delete_own" on public.chunks for delete to authenticated
  using (user_id = (select auth.uid()));

-- ========== Права доступа ==========
revoke all on public.documents, public.chunks from anon;
grant select, insert, update, delete on public.documents to authenticated;
revoke update on public.chunks from authenticated;
grant select, insert, delete on public.chunks to authenticated;

-- ========== Защита от обхода сервера: не больше 10 документов на пользователя ==========
-- Сервер проверяет это сам (с понятной ошибкой), а триггер — запасная защита в базе.
create or replace function public.documents_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.documents where user_id = new.user_id) >= 10 then
    raise exception 'documents_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_limit on public.documents;
create trigger documents_limit before insert on public.documents
  for each row execute function public.documents_limit();

-- ========== Поиск частей документа ==========
-- Сначала ищем части, где есть ВСЕ слова запроса. Если таких нет — где есть ХОТЯ БЫ ОДНО.
-- Если и так ничего — пустой результат (сервер скажет ИИ, что в документе ответа нет).
-- security invoker: функция работает с правами пользователя, RLS видна как обычно.
create or replace function public.search_chunks(p_document_id uuid, p_query text, p_limit int default 5)
returns table (idx int, page_start int, page_end int, content text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  lim      int := least(greatest(coalesce(p_limit, 5), 1), 20);
  q_text   text := left(coalesce(p_query, ''), 500);
  q_all    tsquery;
  q_any    tsquery;
  found    int;
begin
  if btrim(q_text) = '' then
    return;
  end if;

  -- Запрос разбираем русской конфигурацией: она приводит к основе и русские, и английские
  -- слова и выбрасывает служебные слова обоих языков («и», «в», «the»).
  -- 1) Все слова запроса (как в поисковике: websearch_to_tsquery понимает "фразы" и -минус)
  q_all := websearch_to_tsquery('russian', q_text);
  return query
    select c.idx, c.page_start, c.page_end, c.content, ts_rank(c.fts, q_all) as rank
    from public.chunks c
    where c.document_id = p_document_id
      and c.fts @@ q_all
    order by rank desc, c.idx
    limit lim;
  get diagnostics found = row_count;
  if found > 0 then
    return;
  end if;

  -- 2) Хотя бы одно слово: собираем запрос «слово1 | слово2 | …» из словоформ запроса
  begin
    select string_agg(quote_literal(w), ' | ')::tsquery
      into q_any
      from (
        select distinct w
        from unnest(tsvector_to_array(to_tsvector('russian', q_text))) as w
        where w !~ '[\\'']'
        limit 30
      ) words;
  exception when others then
    q_any := null;
  end;
  if q_any is null then
    return;
  end if;

  return query
    select c.idx, c.page_start, c.page_end, c.content, ts_rank(c.fts, q_any) as rank
    from public.chunks c
    where c.document_id = p_document_id
      and c.fts @@ q_any
    order by rank desc, c.idx
    limit lim;
end;
$$;

revoke all on function public.search_chunks(uuid, text, int) from public, anon;
grant execute on function public.search_chunks(uuid, text, int) to authenticated;
revoke all on function public.documents_limit() from public, anon, authenticated;

-- Попросить REST API Supabase сразу увидеть новые таблицы и функцию
notify pgrst, 'reload schema';
