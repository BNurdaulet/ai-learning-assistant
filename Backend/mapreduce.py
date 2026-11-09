"""Конспект, план и карточки по большому документу (map-reduce).

Весь документ в один запрос к ИИ не помещается, поэтому:
1) map: выбираем части равномерно по документу (или по страницам/теме), делим на группы
   и просим ИИ сделать короткие заметки по каждой группе (до 3 запросов одновременно);
2) reduce: из заметок делаем итоговый конспект, план или карточки (ещё один запрос).
Всего не больше MAX_MAPREDUCE_CALLS запросов к ИИ. Если документ маленький — сразу один запрос.
"""
from concurrent.futures import ThreadPoolExecutor

import retrieval
from ai import ask_text, material_block
from config import MAX_CONTEXT_CHARS, MAX_MAPREDUCE_CALLS, MAX_TOPIC_CHARS
from documents import get_ready_document

PARALLEL = 3


def _map_prompt(context, topic, limit, paged):
    focus = f" Особое внимание удели теме «{topic}»." if topic else ""
    pages = " Указывай страницы в скобках, например (стр. 12), по меткам [стр. …]." if paged else ""
    return (
        "Ниже часть учебного документа. Выпиши сжато самое важное: ключевые понятия "
        "с короткими определениями, главные факты, формулы (в LaTeX между $...$), даты и примеры."
        + focus + pages +
        f" Пиши списком, без вступлений, не длиннее {limit} символов. "
        "Пиши на том же языке, на котором написан документ."
        + material_block(context)
    )


def _groups(chunks, size):
    ordered = sorted(chunks, key=lambda c: int(c["idx"]))
    return [ordered[i:i + size] for i in range(0, len(ordered), size)]


def document_material(user, data):
    """Готовит материал для итогового запроса (конспект/план/карточки) по документу.
    Возвращает словарь: topic, material, note, sources — или None, если ИИ не ответил."""
    doc = get_ready_document(user, data.document_id)
    topic = data.topic.strip()[:MAX_TOPIC_CHARS]
    paged = retrieval.is_paged(doc)
    per_call = retrieval.CHUNKS_PER_CALL
    max_map_calls = MAX_MAPREDUCE_CALLS - 1  # один запрос остаётся на итог
    picked = retrieval.select_for_scope(
        user, doc, data.scope, topic, data.page_from, data.page_to, per_call * max_map_calls)
    chunks = picked["chunks"]
    notes = [picked["note"]] if picked["note"] else []
    sources = retrieval.page_sources(chunks) if paged else []

    # Маленький документ (или узкая область): хватит одного запроса
    if len(chunks) <= per_call:
        material, used = retrieval.build_context(chunks, paged)
        if len(used) < picked["total"]:
            notes.append(f"Документ большой: использована выборка — {len(used)} из {picked['total']} частей.")
        return {"topic": picked["topic"], "material": material, "note": " ".join(notes),
                "sources": retrieval.page_sources(used) if paged else []}

    # map: заметки по каждой группе частей
    groups = _groups(chunks, per_call)[:max_map_calls]
    limit = MAX_CONTEXT_CHARS // len(groups) - 80

    def summarize(group):
        context, _ = retrieval.build_context(group, paged)
        return ask_text(_map_prompt(context, picked["topic"], limit, paged), "Заметки по части документа")

    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        results = list(pool.map(summarize, groups))

    parts = []
    for group, text in zip(groups, results):
        if not text:
            continue
        label = retrieval.page_label({"idx": group[0]["idx"], "page_start": group[0]["page_start"],
                                      "page_end": group[-1]["page_end"]}, paged)
        parts.append(f"{label}\n{text.strip()[:limit]}")
    if not parts:
        return None

    if len(parts) < len(groups):
        notes.append(f"Часть документа обработать не удалось ({len(groups) - len(parts)} из {len(groups)} разделов).")
    used = sum(len(g) for g, t in zip(groups, results) if t)
    if used < picked["total"]:
        notes.append(f"Документ большой: использована равномерная выборка — {used} из {picked['total']} частей.")
    return {"topic": picked["topic"], "material": "\n\n".join(parts), "note": " ".join(notes), "sources": sources}
