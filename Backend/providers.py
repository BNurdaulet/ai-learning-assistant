import httpx

from config import GROQ_API_KEY, GROQ_MODEL, GROQ_URL


def groq_request(messages, json_mode=False):
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY не задан")

    payload = {"model": GROQ_MODEL, "messages": messages, "temperature": 0.7}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    response = httpx.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
        json=payload,
        timeout=60,
    )
    if response.status_code != 200:
        err = RuntimeError(f"Groq {response.status_code}: {response.text}")
        err.code = response.status_code
        raise err
    return response.json()["choices"][0]["message"]["content"]


def is_limit_error(error):
    """Похоже ли, что закончился лимит (ошибка 429)."""
    code = getattr(error, "code", None)
    return code == 429 or "RESOURCE_EXHAUSTED" in str(error)
