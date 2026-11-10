"""Выбор частей документа для ИИ.

- search: полнотекстовый поиск по вопросу (функция search_chunks в Postgres);
- sample_range: равномерная выборка частей по всему документу или по диапазону страниц;
- build_context: склеивает части с метками «[стр. 12–13]», не превышая лимит символов;
- page_sources: диапазоны страниц для подписи «Источники» под ответом.

Все запросы к базе идут с токеном пользователя (RLS), поэтому чужие части недоступны.
"""
import supabase_db as db
from config import CHUNK_SIZE, MAX_CONTEXT_CHARS
from errors import AppError, note

MAX_QUERY_CHARS = 500
# Примерно столько частей помещается в один запрос к ИИ (с запасом на метки страниц)
CHUNKS_PER_CALL = max(1, MAX_CONTEXT_CHARS // (CHUNK_SIZE + 40))


def search(user, document_id, query, limit):
    """Самые подходящие части по запросу (может вернуть пустой список)."""
    query = " ".join((query or "").split())[:MAX_QUERY_CHARS]
    if not query:
        return []
    limit = max(1, min(int(limit), 20))
    rows = db.rpc("search_chunks", user.token, {
        "p_document_id": document_id, "p_query": query, "p_limit": limit,
    })
    return rows if isinstance(rows, list) else []


def even_indices(first, last, k):
    """k номеров, равномерно разложенных от first до last включительно."""
    total = last - first + 1
    if total <= 0 or k <= 0:
        return []
    if total <= k:
        return list(range(first, last + 1))
    if k == 1:
        return [first + total // 2]
    step = (total - 1) / (k - 1)
    return sorted({first + round(i * step) for i in range(k)})


def _fetch(user, document_id, params):
    return db.rest("GET", "chunks", user.token, params={
        "document_id": f"eq.{document_id}",
        "user_id": f"eq.{user.id}",
        "select": "idx,page_start,page_end,content",
        **params,
    })


def fetch_by_idx(user, document_id, indices):
    """Части с заданными номерами (по возрастанию номера)."""
    rows = []
    indices = sorted(set(indices))
    for i in range(0, len(indices), 100):  # не делаем слишком длинный адрес запроса
        part = ",".join(str(x) for x in indices[i:i + 100])
        rows += _fetch(user, document_id, {"idx": f"in.({part})", "order": "idx.asc"})
    return rows


def clamp_pages(doc, page_from, page_to):
    """Проверяет диапазон страниц. Возвращает (от, до) в пределах документа."""
    pages = max(1, int(doc.get("pages") or 1))
    if page_from is None and page_to is None:
        raise AppError(400, "pages_required")
    start = page_from if page_from is not None else 1
    end = page_to if page_to is not None else pages
    if start > end:
        start, end = end, start
    start = max(1, min(start, pages))
    end = max(1, min(end, pages))
    return start, end


def idx_range(user, doc, page_from=None, page_to=None):
    """Номера первой и последней части документа (или диапазона страниц).
    Возвращает (first, last) или None, если на этих страницах нет текста."""
    if page_from is None:
        return 0, int(doc["chunk_count"]) - 1
    in_range = {"page_end": f"gte.{page_from}", "page_start": f"lte.{page_to}", "select": "idx", "limit": "1"}
    first = _fetch(user, doc["id"], {**in_range, "order": "idx.asc"})
    last = _fetch(user, doc["id"], {**in_range, "order": "idx.desc"})
    if not first or not last:
        return None
    return int(first[0]["idx"]), int(last[0]["idx"])


def sample_range(user, doc, k, page_from=None, page_to=None):
    """До k частей, равномерно по документу или по страницам page_from–page_to.
    Возвращает (части, сколько всего частей в выбранной области)."""
    bounds = idx_range(user, doc, page_from, page_to)
    if bounds is None:
        return [], 0
    first, last = bounds
    chunks = fetch_by_idx(user, doc["id"], even_indices(first, last, k))
    return chunks, last - first + 1


def page_label(chunk, paged=True):
    if not paged:
        return f"[фрагмент {int(chunk['idx']) + 1}]"
    a, b = int(chunk["page_start"]), int(chunk["page_end"])
    return f"[стр. {a}]" if a == b else f"[стр. {a}–{b}]"


def build_context(chunks, paged=True, max_chars=MAX_CONTEXT_CHARS):
    """Склеивает части (по порядку в документе) с метками страниц. Не длиннее max_chars.
    Возвращает (текст, использованные части)."""
    ordered = sorted(chunks, key=lambda c: int(c["idx"]))
    parts = []
    used = []
    length = 0
    for c in ordered:
        piece = f"{page_label(c, paged)}\n{c['content'].strip()}"
        if length + len(piece) + 2 > max_chars:
            room = max_chars - length - 2
            if not parts and room > 200:  # хотя бы одна часть, пусть и обрезанная
                parts.append(piece[:room])
                used.append(c)
            break
        parts.append(piece)
        used.append(c)
        length += len(piece) + 2
    return "\n\n".join(parts), used


def page_sources(chunks):
    """Склеивает страницы частей в диапазоны: [{"page_start": 12, "page_end": 14}, ...]."""
    spans = sorted((int(c["page_start"]), int(c["page_end"])) for c in chunks)
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [{"page_start": a, "page_end": b} for a, b in merged]


def is_paged(doc):
    """У PDF есть страницы; TXT/MD — одна «страница», на неё ссылаться бессмысленно."""
    return int(doc.get("pages") or 0) > 1


SCOPES = ("all", "pages", "topic")


def select_for_scope(user, doc, scope, topic, page_from, page_to, k):
    """Выбирает до k частей документа для квиза/карточек/конспекта.
    scope: "all" — равномерно по всему документу; "pages" — по диапазону страниц;
    "topic" — поиск по теме (если ничего не найдено — весь документ и пояснение в note).
    Возвращает словарь: chunks, total (частей в выбранной области), topic (тема для промпта или ""),
    note (список пояснений для пользователя {code, params}, может быть пустым)."""
    if scope not in SCOPES:
        raise AppError(400, "unknown_scope")

    if scope == "pages":
        start, end = clamp_pages(doc, page_from, page_to)
        chunks, total = sample_range(user, doc, k, start, end)
        if not chunks:
            raise AppError(422, "pages_no_text", start=start, end=end)
        notes = []
        if (page_from, page_to) != (start, end):
            notes.append(note("pages_used", start=start, end=end, pages=doc["pages"]))
        return {"chunks": chunks, "total": total, "topic": "", "note": notes}

    if scope == "topic":
        if not topic:
            raise AppError(400, "scope_topic_required")
        hits = search(user, doc["id"], topic, k)
        if hits:
            return {"chunks": hits, "total": len(hits), "topic": topic, "note": []}
        chunks, total = sample_range(user, doc, k)
        return {"chunks": chunks, "total": total, "topic": "",
                "note": [note("topic_not_found", topic=topic)]}

    chunks, total = sample_range(user, doc, k)
    return {"chunks": chunks, "total": total, "topic": "", "note": []}
