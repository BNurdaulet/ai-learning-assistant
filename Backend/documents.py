"""Большие документы: загрузка, список, удаление.

Файл читается постранично, текст режется на части (chunking.py), части
записываются в Supabase пачками. Все запросы идут с токеном пользователя,
поэтому RLS не даст тронуть чужие документы. Текст документов в лог не пишем.
"""
import os
import re

from fastapi import HTTPException

import supabase_db as db
from chunking import chunk_pages, clean_page
from config import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MAX_DOC_CHARS,
    MAX_DOC_UPLOAD_BYTES,
    MAX_DOCUMENTS,
    MAX_PAGES,
    MAX_TOTAL_DOC_CHARS,
)
from files import FileError, read_pages
from userdata import NOT_FOUND, parse_id

INSERT_BATCH = 100   # сколько частей отправляем в базу за один запрос
DOC_FIELDS = "id,title,filename,pages,chars,chunk_count,created_at"


def _fmt(n):
    return f"{n:,}".replace(",", " ")


def clean_filename(filename):
    """Только имя файла (без папок), без управляющих символов, не длиннее 255."""
    name = os.path.basename((filename or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:255] or "document"


def make_title(filename):
    title = re.sub(r"\.(pdf|txt|md)$", "", filename, flags=re.IGNORECASE)
    title = re.sub(r"[_]+", " ", title).strip()
    return title[:200] or "Документ"


def file_size(fileobj):
    fileobj.seek(0, os.SEEK_END)
    size = fileobj.tell()
    fileobj.seek(0)
    return size


def _usage(user):
    rows = db.rest("GET", "documents", user.token, params={
        "user_id": f"eq.{user.id}", "select": "id,chars",
    })
    return len(rows), sum(int(r.get("chars") or 0) for r in rows)


def upload_document(user, filename, fileobj):
    """Читает файл, режет на части и сохраняет. Возвращает краткие сведения о документе."""
    filename = clean_filename(filename)
    if not filename.lower().endswith((".pdf", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="Поддерживаются только PDF, TXT и MD.")
    if file_size(fileobj) > MAX_DOC_UPLOAD_BYTES:
        raise HTTPException(status_code=413,
                            detail=f"Файл слишком большой (максимум {MAX_DOC_UPLOAD_BYTES // (1024 * 1024)} МБ).")

    count, used_chars = _usage(user)
    if count >= MAX_DOCUMENTS:
        raise HTTPException(status_code=400, detail=(
            f"Достигнут лимит: {count} из {MAX_DOCUMENTS} документов. Удалите ненужный и попробуйте снова."))

    try:
        pages, page_count, empty_pages = read_pages(filename, fileobj, MAX_PAGES, MAX_DOC_CHARS)
    except FileError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    chars = sum(len(clean_page(p)) for p in pages)
    if used_chars + chars > MAX_TOTAL_DOC_CHARS:
        free = max(0, MAX_TOTAL_DOC_CHARS - used_chars)
        raise HTTPException(status_code=413, detail=(
            f"Не хватает места: в документе {_fmt(chars)} символов, а свободно {_fmt(free)} "
            f"из {_fmt(MAX_TOTAL_DOC_CHARS)}. Удалите ненужные документы."))

    chunks = chunk_pages(pages, CHUNK_SIZE, CHUNK_OVERLAP)
    del pages  # текст страниц больше не нужен, освобождаем память
    if not chunks:
        raise HTTPException(status_code=422, detail="В файле не найден текст.")

    doc = db.rest("POST", "documents", user.token, body={
        "user_id": user.id,
        "title": make_title(filename),
        "filename": filename,
        "pages": page_count,
        "chars": chars,
    }, returning=True)[0]

    try:
        for i in range(0, len(chunks), INSERT_BATCH):
            batch = [{"document_id": doc["id"], "user_id": user.id, **c} for c in chunks[i:i + INSERT_BATCH]]
            db.rest("POST", "chunks", user.token, body=batch)
        db.rest("PATCH", "documents", user.token, params={
            "id": f"eq.{doc['id']}", "user_id": f"eq.{user.id}",
        }, body={"chunk_count": len(chunks)})
    except Exception:
        # Не оставляем полупустой документ: удаляем его (части удалятся каскадом)
        print("Загрузка документа прервана, удаляю неполный документ")
        try:
            db.rest("DELETE", "documents", user.token, params={
                "id": f"eq.{doc['id']}", "user_id": f"eq.{user.id}",
            })
        except db.DbError:
            pass
        raise

    print(f"Документ загружен: {page_count} стр., {len(chunks)} частей")
    result = {
        "id": doc["id"],
        "title": doc["title"],
        "filename": filename,
        "pages": page_count,
        "chars": chars,
        "chunk_count": len(chunks),
        "created_at": doc.get("created_at"),
    }
    if empty_pages and page_count > 1:
        result["warning"] = (
            f"На {empty_pages} из {page_count} страниц не найден текст (возможно, это сканы или картинки) — "
            "они пропущены.")
    return result


def list_documents(user):
    return db.rest("GET", "documents", user.token, params={
        "user_id": f"eq.{user.id}",
        "select": DOC_FIELDS,
        "order": "created_at.desc",
        "limit": str(MAX_DOCUMENTS * 2),
    })


def get_document(user, document_id):
    rows = db.rest("GET", "documents", user.token, params={
        "id": f"eq.{parse_id(document_id)}",
        "user_id": f"eq.{user.id}",
        "select": DOC_FIELDS,
    })
    if not rows:
        raise HTTPException(status_code=404, detail="Документ не найден. Возможно, он удалён.")
    return rows[0]


def get_ready_document(user, document_id):
    """Документ, по которому можно работать (все части загружены)."""
    doc = get_document(user, document_id)
    if not doc.get("chunk_count"):
        raise HTTPException(status_code=409, detail=(
            "Документ загружен не полностью. Удалите его и загрузите снова."))
    return doc


def delete_document(user, document_id):
    rows = db.rest("DELETE", "documents", user.token, params={
        "id": f"eq.{parse_id(document_id)}",
        "user_id": f"eq.{user.id}",
        "select": "id",
    }, returning=True)
    if not rows:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return {"deleted": True}
