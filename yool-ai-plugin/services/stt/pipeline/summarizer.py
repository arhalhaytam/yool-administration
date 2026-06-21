"""OpenAI-powered topic outline generation + embeddings.

Enterprise pivot:
- The output is not a study aid. It is a chronological coverage map: what was
  actually explained during the lecture, with timestamps, so the institution
  can see whether the syllabus was delivered.
- Live partial summaries were removed entirely (no live catch-up exists).

Schema:
    {
      "language":         "fr",
      "duration_minutes": 75,
      "topics": [
        {
          "start_time":   "00:00:00",
          "end_time":     "00:08:30",
          "title":        "short topic title (5-10 words)",
          "description":  "2-3 sentence factual description of what was said",
          "key_concepts": ["term 1", "term 2"]
        }
      ]
    }

Top-level metadata (course_title, teacher_name, session_title, session_id,
recorded_at) is injected by the persistence layer in
`services/stt/pipeline/processor.py` from the database — never trusted from
the LLM — so every stored topic outline is self-contained when exported.
"""

import asyncio
import json

import openai
import structlog

from core.config import settings
from pipeline.pii_filter import scrub

log = structlog.get_logger()

_client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

_TOPIC_OUTLINE_SCHEMA = """
{
  "language":         "fr | en | ar | es | ...",
  "duration_minutes": 75,
  "context_score":    0.85,
  "topics": [
    {
      "start_time":   "HH:MM:SS",
      "end_time":     "HH:MM:SS",
      "title":        "short topic title (5-10 words)",
      "description":  "2-3 sentence factual description of what was actually said",
      "key_concepts": ["term 1", "term 2", "..."]
    }
  ]
}
"""

_MSA_INSTRUCTION = (
    "If the transcript contains Darija (Algerian/Moroccan Arabic dialect), "
    "normalize topic titles and descriptions to Modern Standard Arabic (MSA). "
    "Keep technical terms in French or English as-is."
)


def _build_prompt(transcript_text: str, language: str, context_metadata: dict | None = None) -> str:
    ctx_str = ""
    ctx_score_instruction = (
        "- context_score: set to 1.0 (no chapter context was provided to evaluate against)."
    )
    if context_metadata:
        level = context_metadata.get("level_name", "Unknown Level")
        matiere = context_metadata.get("matiere_name", "Unknown Subject")
        chapter = context_metadata.get("chapter_title", "Unknown Chapter")
        ctx_str = (
            f"Context: This is a {matiere} class for {level}. "
            f"The syllabus chapter being taught is '{chapter}'.\n"
        )
        ctx_score_instruction = (
            f"- context_score: a float between 0.0 and 1.0 rating how closely the professor "
            f"stayed on the chapter topic '{chapter}'. "
            f"1.0 = every topic strictly follows the chapter syllabus. "
            f"0.0 = the professor went entirely off-topic. "
            f"Be honest — score below 0.6 if significant time was spent on unrelated content."
        )

    return f"""You are an audit-grade lecture coverage analyst.

Below is the FULL transcript of a completed teaching session in {language}.
{ctx_str}
You are NOT writing study material, a summary, or a quiz. You are producing
a chronological topic outline so an enterprise reader can see exactly which
parts of the course material the teacher delivered, and when.

{_MSA_INSTRUCTION}

Produce a structured JSON object that EXACTLY matches this schema:
{_TOPIC_OUTLINE_SCHEMA}

Rules:
- Respond with valid JSON only — no markdown, no explanation, no preamble.
- topics[] must be in strict chronological order (start_time ascending).
- Every topic must have a non-empty title and description.
- description must be factual and based ONLY on what was said in the transcript.
  Do NOT invent content, do NOT add your own commentary, do NOT pad with study tips.
- start_time and end_time are HH:MM:SS strings, measured from the start of the recording.
- Group continuously-discussed material into a single topic; split on clear topic changes.
- titles and descriptions are written in the dominant language of the session.
- key_concepts are short technical terms / proper nouns mentioned during that topic.
  Empty array if none. Do not hallucinate concepts.
- duration_minutes is the integer number of minutes spanned by the recording
  (round to nearest minute). Use the last segment timestamp.
{ctx_score_instruction}

Transcript:
---
{transcript_text}
---
"""


async def generate_topic_outline(transcript_text: str, language: str = "fr", context_metadata: dict | None = None) -> dict:
    """Generate the final topic outline from the full transcript of a lecture.

    Returns a dict with `language`, `duration_minutes`, and `topics[]`.
    Top-level metadata (course title, teacher name, etc.) is injected by the
    caller in `processor.py` after this returns.
    """
    clean_text = scrub(transcript_text)
    if not clean_text.strip():
        log.info("topic_outline.skipped_empty_transcript", language=language)
        return {
            "language": language,
            "duration_minutes": 0,
            "context_score": 1.0,
            "topics": [],
        }

    prompt = _build_prompt(clean_text, language, context_metadata)

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            response = await _client.chat.completions.create(
                model=settings.OPENAI_CHAT_MODEL,
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "system",
                        "content": "You are an audit-grade lecture coverage analyst. Respond with valid JSON only.",
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            raw = (response.choices[0].message.content or "").strip()
            if not raw:
                log.error("topic_outline.empty_model_response")
                return {
                    "language": language,
                    "duration_minutes": 0,
                    "topics": [],
                }
            try:
                result = json.loads(raw)
                score = result.get("context_score")
                if not isinstance(score, (int, float)) or not (0.0 <= float(score) <= 1.0):
                    result["context_score"] = 1.0
                else:
                    result["context_score"] = float(score)
                return result
            except json.JSONDecodeError as je:
                log.error("topic_outline.invalid_json", error=str(je), preview=raw[:200])
                return {
                    "language": language,
                    "duration_minutes": 0,
                    "context_score": 1.0,
                    "topics": [],
                }
        except openai.RateLimitError as e:
            if attempt < max_attempts:
                wait_secs = 60 * attempt  # 60s, 120s
                log.warning(
                    "topic_outline.rate_limited_retrying",
                    attempt=attempt,
                    wait_seconds=wait_secs,
                    error=str(e)[:300],
                )
                await asyncio.sleep(wait_secs)
                continue
            log.error("topic_outline.failed", attempt=attempt, error=str(e)[:400])
            return {
                "language": language,
                "duration_minutes": 0,
                "context_score": 1.0,
                "topics": [],
            }
        except Exception as e:
            log.error("topic_outline.failed", attempt=attempt, error=str(e)[:400])
            return {
                "language": language,
                "duration_minutes": 0,
                "context_score": 1.0,
                "topics": [],
            }


async def generate_embedding(text: str) -> list[float]:
    """Generate a 768-dim embedding using OpenAI text-embedding-3-small.

    Uses dimensions=768 so the output matches the existing pgvector Vector(768)
    column — no database migration required.
    """
    clean_text = scrub(text)
    if not clean_text.strip():
        raise ValueError("Cannot embed empty text")

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            result = await _client.embeddings.create(
                model=settings.OPENAI_EMBED_MODEL,
                input=clean_text,
                dimensions=768,
            )
            return result.data[0].embedding
        except openai.RateLimitError as e:
            if attempt < max_attempts:
                wait_secs = 30 * attempt  # 30s, 60s
                log.warning(
                    "generate_embedding.rate_limited_retrying",
                    attempt=attempt,
                    wait_seconds=wait_secs,
                )
                await asyncio.sleep(wait_secs)
                continue
            log.error("generate_embedding.failed", attempt=attempt, error=str(e)[:200])
            raise
        except Exception as e:
            log.error("generate_embedding.failed", attempt=attempt, error=str(e)[:200])
            raise
