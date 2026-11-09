"""Нарезка текста документа на части (chunks) для поиска.

Части примерно одинаковой длины (size символов), соседние части повторяют
друг у друга около overlap символов, чтобы мысль на границе не потерялась.
Режем предпочтительно по абзацу, потом по концу предложения, потом по пробелу,
и только если пробелов нет совсем — посередине слова.
У каждой части запоминаем, с какой по какую страницу она идёт.

Модуль ни от чего не зависит (ни от сети, ни от базы), поэтому легко тестируется.
"""
import bisect
import re

PARAGRAPH = "\n\n"
SENTENCE_END = re.compile(r"[.!?…;:](?:[\"»”')\]]*)\s")


def clean_page(text):
    """Убирает мусор из текста страницы: нулевые символы, лишние пробелы и пустые строки."""
    text = (text or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _find_cut(text, start, end, min_end):
    """Где закончить часть: ищем лучшую границу в text[min_end:end]."""
    pos = text.rfind(PARAGRAPH, min_end, end)
    if pos != -1:
        return pos
    window = text[min_end:end]
    last = None
    for m in SENTENCE_END.finditer(window):
        last = m
    if last:
        return min_end + last.end() - 1  # сразу после знака (и кавычки), на пробеле
    pos = max(text.rfind(" ", min_end, end), text.rfind("\n", min_end, end))
    if pos != -1:
        return pos
    return end  # длинное «слово» без пробелов: режем как есть


def chunk_pages(pages, size, overlap):
    """pages — список текстов страниц (pages[0] — страница 1).
    Возвращает список словарей {idx, page_start, page_end, content}.
    Пустые страницы пропускаются, но номера остальных страниц сохраняются."""
    if size < 100:
        raise ValueError("size слишком маленький")
    overlap = max(0, min(overlap, size // 3))  # перекрытие не больше трети части

    # Склеиваем страницы в один текст и запоминаем, где начинается каждая
    parts = []
    starts = []        # позиция начала страницы в общем тексте
    numbers = []       # номер этой страницы
    length = 0
    for number, page in enumerate(pages, start=1):
        page = clean_page(page)
        if not page:
            continue
        if parts:
            parts.append(PARAGRAPH)
            length += len(PARAGRAPH)
        starts.append(length)
        numbers.append(number)
        parts.append(page)
        length += len(page)
    text = "".join(parts)
    if not text:
        return []

    def page_at(pos):
        return numbers[bisect.bisect_right(starts, pos) - 1]

    chunks = []
    start = 0
    n = len(text)
    while start < n:
        # Пропускаем пробелы в начале части
        while start < n and text[start].isspace():
            start += 1
        if start >= n:
            break

        end = min(start + size, n)
        if end < n:
            end = _find_cut(text, start, end, start + size // 2)

        content = text[start:end].strip()
        if content:
            first = start
            last = start + len(text[start:end].rstrip()) - 1
            chunks.append({
                "idx": len(chunks),
                "page_start": page_at(first),
                "page_end": page_at(last),
                "content": content,
            })
        if end >= n:
            break

        # Следующая часть начинается чуть раньше конца этой (перекрытие),
        # причём с начала слова. Всегда двигаемся вперёд хотя бы на половину size - overlap.
        next_start = end - overlap
        if overlap:
            space = text.find(" ", next_start, end)
            newline = text.find("\n", next_start, end)
            candidates = [p for p in (space, newline) if p != -1]
            if candidates:
                next_start = min(candidates) + 1
        start = max(next_start, start + 1)
    return chunks
