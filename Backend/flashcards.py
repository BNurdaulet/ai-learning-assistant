"""Карточки для запоминания: вопрос/термин на лицевой стороне, ответ на обороте."""
from ai import ask_json, describe_source, language_rule, material_block
from schemas import Flashcards

FORMAT_HINT = '{"cards": [{"front": "термин или вопрос", "back": "определение или ответ"}]}'


def build_prompt(topic, count, material, lang="ru"):
    prompt = (
        f"Составь {count} карточек для запоминания {describe_source(topic, material)}. "
        "front — короткий термин, понятие или вопрос; back — точный и краткий ответ "
        "(1–3 предложения). Карточки не должны повторяться. "
        "Формулы записывай в LaTeX между $...$. "
        + language_rule(lang)
    )
    return prompt + material_block(material)


def generate_flashcards(topic, count, material, lang="ru"):
    """Возвращает список {"front", "back"} или None."""

    def parse(result):
        cards = [
            {"front": c.front.strip(), "back": c.back.strip()}
            for c in result.cards
            if c.front.strip() and c.back.strip()
        ]
        return cards[:count] or None

    prompt = build_prompt(topic, count, material, lang)
    return ask_json(prompt, Flashcards, FORMAT_HINT, parse, "Карточки")
