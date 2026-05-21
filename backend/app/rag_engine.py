"""
Local RAG Engine — wraps RAGAnything (raganything) for document indexing and retrieval.

RAGAnything is an all-in-one document processing + vector search engine.
It handles parsing (PDF, DOCX, Excel, etc.), chunking, embedding, and semantic search.

Usage:
    from app.rag_engine import rag
    await rag.init()
    doc_id = await rag.index_file(file_path, file_name="doc.pdf")
    results = await rag.search("your question")
"""

import os
import asyncio
import uuid
from pathlib import Path
from typing import Optional

from app.config import settings


# ============================================================
# LightRAG-compatible model functions for RAGAnything
# ============================================================

def _create_llm_model_func():
    """Create a LightRAG-compatible LLM model function using OpenAI SDK.

    LightRAG expects: async def llm_model_func(prompt, system_prompt=None, **kwargs) -> str
    """
    from openai import OpenAI as SyncOpenAI

    client = SyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )

    async def llm_func(prompt: str, system_prompt: str | None = None, **kwargs) -> str:
        """LightRAG-compatible LLM call: prompt -> text response."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        model = settings.model_name or "qwen3.6-35B-A3B-apex"
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=kwargs.get("temperature", 0.1),
            max_tokens=kwargs.get("max_tokens", 4096),
        )
        return response.choices[0].message.content or ""

    return llm_func


def _create_embedding_func():
    """Create a LightRAG-compatible embedding function.

    LightRAG expects: EmbeddingFunc instance (dataclass with .func and __call__).
    The __call__ must return a numpy array with total_elements % embedding_dim == 0.
    nomic-embed-text-v1.5 outputs 768-dim embeddings.
    """
    import numpy as np
    import httpx
    from lightrag.utils import wrap_embedding_func_with_attrs
    base_url = settings.openai_base_url.rstrip("/").replace("/v1", "")

    @wrap_embedding_func_with_attrs(embedding_dim=768, max_token_size=8192)
    async def emb_func(texts: list[str]) -> np.ndarray:
        """LightRAG-compatible embedding call.

        Returns: numpy array of shape (len(texts), 768)
        """
        if isinstance(texts, str):
            texts = [texts]
        data = {"model": "text-embedding-nomic-embed-text-v1.5", "input": texts}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{base_url}/v1/embeddings", json=data)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Embedding API error {resp.status_code}: {resp.text[:200]}"
                )
        body = resp.json()
        sorted_data = sorted(body["data"], key=lambda x: x["index"])
        embeddings = [d["embedding"] for d in sorted_data]
        return np.array(embeddings, dtype=np.float32)

    return emb_func


# ============================================================
# RAG Engine Adapter
# ============================================================

class RAGEngineAdapter:
    """Adapter wrapping RAGAnything for the Lunjiao project.

    Each user gets an isolated RAG instance with independent workspace and vector storage.
    Provides a simple async interface for indexing files, searching, and stats.
    """

    def __init__(self):
        """Initialize with an empty user→RAG instance map."""
        self._rags: dict[str, object] = {}

    async def _init_user_rag(self, user_id: str):
        """Lazily create a per-user RAG instance with isolated storage.

        Each user gets their own working_dir and LightRAG workspace, ensuring
        complete data isolation at the vector/knowledge-graph level.
        """
        if user_id in self._rags:
            return

        from raganything import RAGAnything, RAGAnythingConfig

        base_dir = os.path.join(settings.upload_dir, ".rag_storage")
        working_dir = os.path.join(base_dir, user_id)
        parser_output_dir = os.path.join(settings.upload_dir, ".rag_parse_output", user_id)
        os.makedirs(working_dir, exist_ok=True)
        os.makedirs(parser_output_dir, exist_ok=True)

        config = RAGAnythingConfig(
            working_dir=working_dir,
            parser_output_dir=parser_output_dir,
            parser="mineru",
            parse_method="txt",
            enable_image_processing=False,
            enable_table_processing=False,
            enable_equation_processing=False,
            max_concurrent_files=1,
            use_full_path=True,
        )

        rag = RAGAnything(
            config=config,
            llm_model_func=_create_llm_model_func(),
            embedding_func=_create_embedding_func(),
            lightrag_kwargs={
                "workspace": user_id,  # LightRAG data isolation key
            },
        )

        # Initialize the underlying LightRAG engine
        await rag._ensure_lightrag_initialized()
        self._rags[user_id] = rag

    async def _ensure_ready(self, user_id: str):
        """Ensure the per-user RAG instance is initialized before use."""
        if user_id not in self._rags:
            await self._init_user_rag(user_id)

    # ---- File Indexing ----

    async def index_file(
        self, file_path: str, file_name: str | None = None,
        category: str = "上传文件", user_id: str = "default"
    ) -> str:
        """Index a file into the RAG knowledge base for a specific user.

        For plain text files (txt, md), inserts directly into LightRAG
        to bypass the slow MinerU PDF pipeline. For all other formats,
        uses RAGAnything's process_document_complete.

        Returns the doc_id string on success, or empty string on failure.
        """
        await self._ensure_ready(user_id)
        user_rag = self._rags[user_id]

        import hashlib
        doc_id = hashlib.md5(str(file_path).encode()).hexdigest()[:16]
        ext = Path(file_path).suffix.lower()

        # For plain text & Excel files, extract text content and insert directly into LightRAG
        # (skips LibreOffice+PDF+MinerU pipeline entirely)
        text_content = None
        if ext in (".txt", ".md", ".csv"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    text_content = f.read()
                if not text_content.strip():
                    print(f"[RAG-Anything] Empty file: {file_path}")
                    return ""
            except Exception as e:
                print(f"[RAG-Anything] Read error for {file_path}: {e}")
                return ""

        elif ext in (".xlsx", ".xls"):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(file_path, data_only=True)
                lines = []
                for sheet_name in wb.sheetnames:
                    ws = wb[sheet_name]
                    lines.append(f"=== Sheet: {sheet_name} ===")
                    for row in ws.iter_rows(values_only=True):
                        row_str = " | ".join(str(cell) if cell is not None else "" for cell in row)
                        if row_str.strip():
                            lines.append(row_str)
                text_content = "\n".join(lines)
                wb.close()
                if not text_content.strip():
                    print(f"[RAG-Anything] Empty Excel file: {file_path}")
                    return ""
                print(
                    f"[RAG-Anything] Extracted Excel {file_name or Path(file_path).name}: "
                    f"{len(lines)} lines, {len(text_content)} chars"
                )
            except Exception as e:
                print(f"[RAG-Anything] Excel extraction error for {file_path}: {e}")
                return ""

        if text_content is not None:
            # Direct chunk upsert into LightRAG (skips LLM entity extraction entirely)
            try:
                lightrag = user_rag.lightrag
            except AttributeError as e:
                print(f"[RAG-Anything] LightRAG not initialized for user {user_id}: {e}")
                return ""
            paragraphs = [p.strip() for p in text_content.split('\n\n') if p.strip()]
            text_chunks = []
            for para in paragraphs:
                if len(para) > 2000:
                    for line in para.split('\n'):
                        line = line.strip()
                        if line:
                            text_chunks.append(line)
                else:
                    text_chunks.append(para)

            doc_key = hashlib.md5(text_content.encode()).hexdigest()[:16]

            try:
                # Insert full document
                await lightrag.full_docs.upsert(
                    {doc_key: {"content": text_content, "file_path": ""}}
                )

                # Build and insert chunk data (no entity extraction)
                inserting_chunks = {}
                for idx, chunk_text in enumerate(text_chunks):
                    chunk_key = hashlib.md5(chunk_text.encode()).hexdigest()[:16]
                    inserting_chunks[chunk_key] = {
                        "content": chunk_text,
                        "full_doc_id": doc_key,
                        "tokens": len(chunk_text.split()),
                        "chunk_order_index": idx,
                        "file_path": "",
                    }

                await lightrag.chunks_vdb.upsert(inserting_chunks)
                await lightrag.text_chunks.upsert(inserting_chunks)
                await lightrag._insert_done()
            except Exception as e:
                print(f"[RAG-Anything] LightRAG upsert error for {file_name or Path(file_path).name}: {e}")
                # Re-raise so caller can capture the error message
                raise RuntimeError(f"向量索引写入失败: {e}") from e

            print(
                f"[RAG-Anything] Direct-inserted {file_name or Path(file_path).name} "
                f"({len(text_content)} chars) via LightRAG"
            )
        else:
            # For complex formats (PDF, DOCX, etc.), use RAGAnything's pipeline
            try:
                await user_rag.process_document_complete(
                    file_path=file_path,
                    file_name=file_name or Path(file_path).name,
                    doc_id=f"{category}::{doc_id}",
                )
            except Exception as e:
                print(f"[RAG-Anything] Error indexing {file_path}: {e}")
                return ""

        # Store mapping in-memory (keyed by user_id + file_name)
        _doc_id_map[f"{user_id}:{file_name or Path(file_path).name}"] = f"{category}::{doc_id}"
        return doc_id

    # ---- Search ----

    async def search(
        self, query_text: str, category: str | None = None, top_k: int = 3,
        user_id: str = "default"
    ) -> list[dict]:
        """Search indexed documents by semantic similarity for a specific user.

        Uses LightRAG's naive mode (vector-only, no KG entity extraction) for
        speed. Returns raw text chunks as dicts for the agent to consume.
        """
        await self._ensure_ready(user_id)
        lightrag = self._rags[user_id].lightrag

        try:
            # Build a QueryParam with speed-optimized defaults:
            #   mode="naive" — vector-only, skips KG entity/relation extraction
            #   only_need_context=True — returns raw chunks, skips LLM call
            #   top_k=top_k — limit results
            #   chunk_top_k=top_k — consistent
            from lightrag.base import QueryParam

            param = QueryParam(
                mode="naive",
                only_need_context=True,
                top_k=top_k * 2,  # fetch more, deduplicate below
                chunk_top_k=top_k * 2,
                enable_rerank=False,
            )
            result_text = await lightrag.aquery(query_text, param=param)
        except Exception as e:
            print(f"[RAG-Anything] Query error: {e}")
            return []

        if not result_text or not result_text.strip():
            return []

        # Post-process: extract actual content from LightRAG's naive mode output
        import json
        import re

        content_parts = []

        # Try to extract JSON blocks between ``` markers (possibly multi-line)
        for block in re.findall(r"```(?:json)?\s*({.*?})\s*```", result_text, re.DOTALL):
            try:
                obj = json.loads(block)
                content = obj.get("content", "")
                if content:
                    content_parts.append(content)
            except json.JSONDecodeError:
                pass
        # If no JSON parsed, fall back to the raw text
        if not content_parts:
            content_parts.append(result_text.strip())

        # Build structured results
        seen = set()
        results = []
        for text in content_parts:
            text = text.strip()
            if not text or text in seen:
                continue
            seen.add(text)
            results.append({
                "text": text,
                "file_name": "知识库",
                "category": category or "全部",
                "score": 1.0,
            })
            if len(results) >= top_k:
                break

        return results

    async def search_text(
        self, query_text: str, category: str | None = None, top_k: int = 5,
        user_id: str = "default"
    ) -> list[dict]:
        """Fallback keyword search (passthrough to same engine)."""
        return await self.search(query_text, category=category, top_k=top_k, user_id=user_id)

    # ---- Stats ----

    async def stats(self, user_id: str = "default") -> dict:
        """Get RAG index statistics for a specific user."""
        await self._ensure_ready(user_id)
        return self._rags[user_id].get_config_info() if user_id in self._rags else {}

    async def remove_file(self, doc_id: str, user_id: str = "default") -> bool:
        """Remove a file from the RAG index. Not directly supported by RAGAnything,
        but we track by doc_id for future use."""
        await self._ensure_ready(user_id)
        # RAGAnything doesn't expose a direct remove API through its public interface.
        # We log it for now.
        print(f"[RAG-Anything] File removal requested for {doc_id} (not yet implemented)")
        return True


# Singleton
rag = RAGEngineAdapter()

# In-memory doc_id mapping, keyed by (user_id, file_name) -> doc_id
_doc_id_map: dict[str, str] = {}
