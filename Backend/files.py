import io

from pypdf import PdfReader

from config import MAX_MATERIAL_CHARS, MAX_UPLOAD_BYTES
from errors import AppError


class FileError(AppError):
    """Проблема с файлом: код ошибки и параметры (текст — в словаре фронтенда)."""


def extract_text(filename, data):
    """Возвращает (текст, обрезан ли он, всего символов). При проблемах бросает FileError."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise FileError(413, "file_too_large", max_mb=MAX_UPLOAD_BYTES // (1024 * 1024))

    name = (filename or "").lower()
    try:
        if name.endswith(".pdf"):
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
        elif name.endswith((".txt", ".md")):
            text = data.decode("utf-8", errors="ignore")
        else:
            raise FileError(400, "unsupported_file_type")
    except FileError:
        raise
    except Exception as e:
        print(f"Не удалось прочитать файл: {e}")
        raise FileError(400, "file_read_failed")

    text = text.strip()
    if not text:
        raise FileError(422, "file_no_text")

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
            raise FileError(413, "too_much_text", max=max_chars)
        pages, empty = [text], 0 if text.strip() else 1
    else:
        raise FileError(400, "unsupported_file_type")

    total = sum(len(p.strip()) for p in pages)
    if total == 0:
        if name.endswith(".pdf"):
            raise FileError(422, "pdf_no_text_layer")
        raise FileError(422, "file_empty")
    return pages, len(pages), empty


def _read_pdf_pages(fileobj, max_pages, max_chars):
    try:
        reader = PdfReader(fileobj)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise FileError(400, "pdf_encrypted")
        count = len(reader.pages)
    except FileError:
        raise
    except Exception:
        raise FileError(400, "pdf_unreadable")

    if count == 0:
        raise FileError(422, "pdf_no_pages")
    if count > max_pages:
        raise FileError(413, "too_many_pages", count=count, max=max_pages)

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
            raise FileError(413, "too_much_text", max=max_chars)
        pages.append(text)
    return pages, empty
