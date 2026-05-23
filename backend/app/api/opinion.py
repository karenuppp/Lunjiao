from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
import os
from pathlib import Path

router = APIRouter()


class OpinionRequest(BaseModel):
    content: str


@router.post("/opinion")
async def submit_opinion(req: OpinionRequest):
    """Save user feedback as a .txt file in backend/opinions/."""
    opinions_dir = Path(__file__).parent.parent.parent / "opinions"
    opinions_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"feedback_{timestamp}.txt"
    filepath = opinions_dir / filename

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(req.content)

    return {"ok": True, "filename": filename}
