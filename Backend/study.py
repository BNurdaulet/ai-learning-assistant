"""Краткий конспект и план изучения (ответ — Markdown-текст)."""
from ai import ask_text, describe_source, language_rule, material_block

KINDS = {
    "summary": (
        "Составь краткий структурированный конспект {source}. "
        "Используй Markdown: заголовки (##), маркированные списки, выдели **жирным** "
        "ключевые термины. В конце добавь раздел «Ключевые термины» с короткими "
        "определениями. Формулы записывай в LaTeX: внутри строки между $...$, "
        "отдельные формулы между $$...$$. Будь кратким: только главное."
    ),
    "plan": (
        "Составь пошаговый план изучения {source}. "
        "Используй Markdown: каждый шаг — заголовок ### с номером и названием, под ним "
        "что изучить (список), примерное время на шаг (например, «⏱ 30 мин») и "
        "«Вопрос для самопроверки» по этому шагу. В конце укажи общее время. "
        "Формулы записывай в LaTeX между $...$."
    ),
}

LABELS = {"summary": "Конспект", "plan": "План изучения"}


def generate_study(kind, topic, material, lang="ru"):
    """kind: "summary" или "plan". Возвращает Markdown-строку или None."""
    prompt = KINDS[kind].format(source=describe_source(topic, material))
    prompt += " " + language_rule(lang)
    prompt += material_block(material)
    return ask_text(prompt, LABELS[kind])
