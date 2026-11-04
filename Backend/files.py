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
