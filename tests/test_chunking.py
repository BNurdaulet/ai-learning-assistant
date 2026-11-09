"""Тесты нарезки документа на части (Backend/chunking.py).

Запуск из корня проекта:  python -m unittest discover tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Backend"))

from chunking import chunk_pages, clean_page  # noqa: E402

SIZE = 1500
OVERLAP = 200


def sentences(n, prefix="Предложение"):
    return " ".join(f"{prefix} номер {i} про фотосинтез и клетки." for i in range(n))


class ChunkPagesTest(unittest.TestCase):
    def check_basic(self, chunks, size=SIZE):
        """Общие свойства любой нарезки."""
        for i, c in enumerate(chunks):
            self.assertEqual(c["idx"], i)
            self.assertTrue(c["content"])
            self.assertEqual(c["content"], c["content"].strip())
            self.assertLessEqual(len(c["content"]), size)
            self.assertLessEqual(c["page_start"], c["page_end"])
        for a, b in zip(chunks, chunks[1:]):
            self.assertLessEqual(a["page_start"], b["page_start"])

    def test_empty_input(self):
        self.assertEqual(chunk_pages([], SIZE, OVERLAP), [])
        self.assertEqual(chunk_pages(["", "   ", "\n\n", None], SIZE, OVERLAP), [])

    def test_short_text_is_one_chunk(self):
        chunks = chunk_pages(["Короткий текст."], SIZE, OVERLAP)
        self.assertEqual(chunks, [{"idx": 0, "page_start": 1, "page_end": 1, "content": "Короткий текст."}])

    def test_sizes_and_full_coverage(self):
        text = sentences(300)  # ~13 000 символов
        chunks = chunk_pages([text], SIZE, OVERLAP)
        self.check_basic(chunks)
        self.assertGreater(len(chunks), 8)
        # Все части, кроме последней, не слишком короткие (режем не раньше половины size)
        for c in chunks[:-1]:
            self.assertGreaterEqual(len(c["content"]), SIZE // 2 - 1)
        # Ни одно предложение не потеряно
        joined = " ".join(c["content"] for c in chunks)
        for i in range(300):
            self.assertIn(f"номер {i} ", joined)

    def test_cuts_on_sentence_boundary(self):
        chunks = chunk_pages([sentences(200)], SIZE, OVERLAP)
        for c in chunks[:-1]:
            self.assertTrue(c["content"].endswith("."), c["content"][-30:])

    def test_prefers_paragraph_boundary(self):
        first = sentences(25, "Первый")   # ~1000 символов
        second = sentences(25, "Второй")
        chunks = chunk_pages([first + "\n\n" + second], SIZE, OVERLAP)
        self.assertEqual(chunks[0]["content"], first)

    def test_overlap(self):
        chunks = chunk_pages([sentences(200)], SIZE, OVERLAP)
        for a, b in zip(chunks, chunks[1:]):
            # Начало следующей части есть в конце предыдущей
            head = b["content"][:60]
            self.assertIn(head, a["content"][-(OVERLAP + 60):])
            # и начинается оно с целого слова
            pos = a["content"].rfind(head)
            self.assertTrue(pos == 0 or a["content"][pos - 1].isspace())

    def test_no_overlap(self):
        chunks = chunk_pages([sentences(100)], SIZE, 0)
        total = sum(len(c["content"]) for c in chunks)
        self.assertLessEqual(total, len(sentences(100)))

    def test_page_numbers(self):
        pages = [sentences(10, f"Стр{p}") for p in range(1, 21)]  # 20 страниц по ~450 символов
        chunks = chunk_pages(pages, SIZE, OVERLAP)
        self.check_basic(chunks)
        self.assertEqual(chunks[0]["page_start"], 1)
        self.assertEqual(chunks[-1]["page_end"], 20)
        for c in chunks:
            # Метка страницы в тексте совпадает с диапазоном страниц части
            for p in range(1, 21):
                if f"Стр{p} номер" in c["content"]:
                    self.assertTrue(c["page_start"] <= p <= c["page_end"], (p, c["page_start"], c["page_end"]))
            self.assertGreaterEqual(c["page_end"] - c["page_start"], 0)

    def test_empty_pages_keep_numbering(self):
        pages = ["", "Текст второй страницы.", "   ", "", "Текст пятой страницы."]
        chunks = chunk_pages(pages, SIZE, OVERLAP)
        self.assertEqual(len(chunks), 1)
        self.assertEqual((chunks[0]["page_start"], chunks[0]["page_end"]), (2, 5))
        self.assertNotIn("\n\n\n", chunks[0]["content"])

    def test_page_numbers_with_empty_pages_between_big_pages(self):
        pages = [sentences(40, "А"), "", "", sentences(40, "Б")]
        chunks = chunk_pages(pages, SIZE, OVERLAP)
        self.assertEqual(chunks[0]["page_start"], 1)
        self.assertEqual(chunks[-1]["page_end"], 4)
        self.assertTrue(all(c["page_start"] in (1, 4) for c in chunks))

    def test_one_huge_paragraph_without_spaces(self):
        word = "х" * 10_000
        chunks = chunk_pages([word], SIZE, OVERLAP)
        self.check_basic(chunks)
        self.assertGreaterEqual(len(chunks), 7)
        self.assertEqual(len(chunks[0]["content"]), SIZE)
        # Весь текст покрыт: с перекрытием суммарно не меньше исходного
        self.assertGreaterEqual(sum(len(c["content"]) for c in chunks), len(word))

    def test_huge_paragraph_with_spaces_but_no_sentences(self):
        text = " ".join(["слово"] * 3000)  # 18 000 символов одним абзацем
        chunks = chunk_pages([text], SIZE, OVERLAP)
        self.check_basic(chunks)
        for c in chunks:
            self.assertTrue(c["content"].startswith("слово"))
            self.assertTrue(c["content"].endswith("слово"))

    def test_strange_whitespace_and_nul(self):
        chunks = chunk_pages(["a\x00b\r\n\r\n\r\n\r\nc\t\t d"], SIZE, OVERLAP)
        self.assertEqual(chunks[0]["content"], "ab\n\nc d")

    def test_overlap_is_capped(self):
        # Слишком большое перекрытие не должно зациклить нарезку
        chunks = chunk_pages([sentences(100)], 300, 5000)
        self.check_basic(chunks, size=300)
        self.assertLess(len(chunks), 100)

    def test_too_small_size_rejected(self):
        with self.assertRaises(ValueError):
            chunk_pages(["текст"], 10, 0)

    def test_clean_page(self):
        self.assertEqual(clean_page(None), "")
        self.assertEqual(clean_page("  a  \n\n\n\n b   c "), "a\n\nb c")


if __name__ == "__main__":
    unittest.main()
