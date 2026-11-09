import io

from pypdf import PdfReader

from config import MAX_MATERIAL_CHARS, MAX_UPLOAD_BYTES


class FileError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


def extract_text(filename, data):
    """Возвращает (текст, обрезан ли он, всего символов). При проблемах бросает FileError."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise FileError(413, "Файл слишком большой (максимум 10 МБ).")

    name = (filename or "").lower()
    try:
        if name.endswith(".pdf"):
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
        elif name.endswith((".txt", ".md")):
            text = data.decode("utf-8", errors="ignore")
        else:
            raise FileError(400, "Поддерживаются только PDF, TXT и MD.")
    except FileError:
        raise
    except Exception as e:
        raise FileError(400, f"Не удалось прочитать файл: {e}")

    text = text.strip()
    if not text:
        raise FileError(422, "В файле не найден текст (возможно, это скан или картинка).")

    return text[:MAX_MATERIAL_CHARS], len(text) > MAX_MATERIAL_CHARS, len(text)


# ---------- Большие документы: читаем по одной странице ----------

def read_pages(filename, fileobj, max_pages, max_chars):
    """Читает файл постранично и возвращает (страницы, всего_страниц, пустых_страниц).
    PDF читается по одной странице, весь текст сразу в памяти не собирается дважды.
    TXT/MD считаются одной страницей. При проблемах бросает FileError."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        pages, empty = _read_pdf_pages(fileobj, max_pages, max_chars)
    elif name.endswith((".txt", ".md")):
        data = fileobj.read()
        text = data.decode("utf-8-sig", errors="ignore")
        if len(text) > max_chars:
            raise FileError(413, _too_much_text(max_chars))
        pages, empty = [text], 0 if text.strip() else 1
    else:
        raise FileError(400, "Поддерживаются только PDF, TXT и MD.")

    total = sum(len(p.strip()) for p in pages)
    if total == 0:
        if name.endswith(".pdf"):
            raise FileError(422, "В PDF нет текстового слоя — похоже, это скан или картинки. "
                                 "Распознайте текст (OCR), например в Google Диске, и загрузите снова.")
        raise FileError(422, "Файл пустой.")
    return pages, len(pages), empty


def _too_much_text(max_chars):
    return f"В документе слишком много текста (максимум {max_chars:,} символов). Разделите файл на части.".replace(",", " ")


def _read_pdf_pages(fileobj, max_pages, max_chars):
    try:
        reader = PdfReader(fileobj)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise FileError(400, "PDF защищён паролем. Снимите защиту и загрузите снова.")
        count = len(reader.pages)
    except FileError:
        raise
    except Exception:
        raise FileError(400, "Не удалось прочитать PDF: файл повреждён или это не PDF.")

    if count == 0:
        raise FileError(422, "В PDF нет страниц.")
    if count > max_pages:
        raise FileError(413, f"В документе {count} страниц, максимум {max_pages}. Разделите файл на части.")

    pages = []
    empty = 0
    total = 0
    for i in range(count):
        try:
            text = reader.pages[i].extract_text() or ""
        except Exception:
            text = ""  # одна битая страница не должна ломать весь документ
        if not text.strip():
            empty += 1
        total += len(text)
        if total > max_chars:
            raise FileError(413, _too_much_text(max_chars))
        pages.append(text)
    return pages, empty
