"""Agent configuration — injectable parameters instead of hardcoded constants."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ReActConfig:
    """Reasoning-acting loop configuration."""

    max_rounds: int = 5
    """Maximum tool-calling rounds before forcing a final answer."""

    temperature: float = 0.2
    """LLM temperature for every model call in the loop."""

    stream_tokens: bool = True
    """Whether to yield per-token TextDeltaEvents during streaming."""

    tool_choice: str = "auto"
    """OpenAI tool_choice parameter ('auto', 'none', 'required')."""


@dataclass
class AgentConfig:
    """Top-level agent configuration."""

    model: str = ""
    """Model name override. Empty = use settings.model_name."""

    react: ReActConfig = field(default_factory=ReActConfig)
    """ReAct loop parameters."""
