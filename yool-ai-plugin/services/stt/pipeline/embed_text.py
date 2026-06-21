"""Helpers for deterministic summary embedding text construction."""


def build_searchable_text(outline: dict) -> str:
    """Build the exact text payload used for summary embeddings."""
    searchable_parts: list[str] = [
        outline.get("course_title", ""),
        outline.get("session_title", ""),
    ]
    for topic in outline.get("topics", []) or []:
        searchable_parts.append(topic.get("title", ""))
        searchable_parts.append(topic.get("description", ""))
        searchable_parts.extend(topic.get("key_concepts", []) or [])
    return " ".join(part for part in searchable_parts if part).strip()
