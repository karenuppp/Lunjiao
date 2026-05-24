import os
import asyncio
import uuid
from pathlib import Path
from typing import Optional

import json

from app.config import settings


def _create_llm_model_func():
    from openai import OpenAI as SyncOpenAI

    client = SyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )

    async def llm_func(prompt: str, system_prompt: str | None = None, **kwargs) -> str:
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
    import numpy as np
    import httpx
    from lightrag.utils import wrap_embedding_func_with_attrs
    base_url = settings.embedding_base_url.rstrip("/").replace("/v1", "")
    api_key = settings.embedding_api_key

    embedding_dim_val = settings.embedding_dim
    embedding_model_val = settings.embedding_model

    @wrap_embedding_func_with_attrs(embedding_dim=embedding_dim_val, max_token_size=8192)
    async def emb_func(texts: list[str]) -> np.ndarray:
        if isinstance(texts, str):
            texts = [texts]
        data = {"model": embedding_model_val, "input": texts}
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/v1/embeddings", json=data, headers=headers,
            )
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Embedding API error {resp.status_code}: {resp.text[:200]}"
                )
        body = resp.json()
        sorted_data = sorted(body["data"], key=lambda x: x["index"])
        embeddings = [d["embedding"] for d in sorted_data]
        return np.array(embeddings, dtype=np.float32)

    return emb_func


class RAGEngineAdapter:

    def __init__(self):
        self._rags: dict[str, object] = {}

    async def _init_user_rag(self, user_id: str):
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
            max_context_tokens=settings.rag_max_context_tokens,
            use_full_path=True,
        )

        rag = RAGAnything(
            config=config,
            llm_model_func=_create_llm_model_func(),
            embedding_func=_create_embedding_func(),
            lightrag_kwargs={
                "workspace": user_id,
                "embedding_func_max_async": settings.embedding_workers,
                "embedding_batch_num": 16,
                "chunk_top_k": settings.rag_chunk_top_k,
                "cosine_threshold": settings.rag_cosine_threshold,
                "max_parallel_insert": 1,
                "enable_llm_cache": True,
                "enable_llm_cache_for_entity_extract": True,
            },
        )

        await rag._ensure_lightrag_initialized()
        self._rags[user_id] = rag

    async def _ensure_ready(self, user_id: str):
        if user_id not in self._rags:
            await self._init_user_rag(user_id)

    def _build_category_map(self) -> dict[str, str]:
        """Build file_path → category mapping from .meta files on disk."""
        mapping: dict[str, str] = {}
        upload_dir = Path(settings.upload_dir)
        if not upload_dir.exists():
            return mapping
        for meta_path in upload_dir.glob("*.meta"):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            category = meta.get("category", "")
            if category == "上传文件":
                category = ""
            original_name = meta.get("original_name", "")
            if not original_name:
                continue
            file_id = meta_path.stem
            for fpath in upload_dir.iterdir():
                if not fpath.is_file() or fpath.suffix == ".meta":
                    continue
                if fpath.name.startswith(f"{file_id}_"):
                    mapping[str(fpath.resolve())] = category
                    break
        return mapping

    async def index_file(
        self, file_path: str, file_name: str | None = None,
        category: str = "", user_id: str = "default"
    ) -> str:
        await self._ensure_ready(user_id)
        user_rag = self._rags[user_id]

        import hashlib
        doc_id = hashlib.md5(str(file_path).encode()).hexdigest()[:16]
        ext = Path(file_path).suffix.lower()

        # Bypass the slow MinerU PDF pipeline for text/Excel: extract content and
        # insert directly into LightRAG.
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
                await lightrag.full_docs.upsert(
                    {doc_key: {"content": text_content, "file_path": file_path}}
                )

                inserting_chunks = {}
                for idx, chunk_text in enumerate(text_chunks):
                    chunk_key = hashlib.md5(chunk_text.encode()).hexdigest()[:16]
                    inserting_chunks[chunk_key] = {
                        "content": chunk_text,
                        "full_doc_id": doc_key,
                        "tokens": len(chunk_text.split()),
                        "chunk_order_index": idx,
                        "file_path": file_path,
                    }

                await lightrag.chunks_vdb.upsert(inserting_chunks)
                await lightrag.text_chunks.upsert(inserting_chunks)
                await lightrag._insert_done()
            except Exception as e:
                print(f"[RAG-Anything] LightRAG upsert error for {file_name or Path(file_path).name}: {e}")
                raise RuntimeError(f"向量索引写入失败: {e}") from e

            print(
                f"[RAG-Anything] Direct-inserted {file_name or Path(file_path).name} "
                f"({len(text_content)} chars) via LightRAG"
            )
        else:
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

    async def search(
        self, query_text: str, category: str | None = None, top_k: int = 3,
        user_id: str = "default"
    ) -> list[dict]:
        await self._ensure_ready(user_id)
        lightrag = self._rags[user_id].lightrag

        try:
            from lightrag.base import QueryParam

            if category:
                return await self._search_with_category(
                    lightrag, query_text, category, top_k, user_id
                )

            param = QueryParam(
                mode="naive",
                only_need_context=True,
                top_k=settings.rag_chunk_top_k,
                chunk_top_k=settings.rag_chunk_top_k,
                enable_rerank=False,
            )
            result_text = await lightrag.aquery(query_text, param=param)
        except Exception as e:
            print(f"[RAG-Anything] Query error: {e}")
            return []

        if not result_text or not result_text.strip():
            return []

        import json
        import re

        content_parts = []

        for block in re.findall(r"```(?:json)?\s*({.*?})\s*```", result_text, re.DOTALL):
            try:
                obj = json.loads(block)
                content = obj.get("content", "")
                if content:
                    content_parts.append(content)
            except json.JSONDecodeError:
                pass
        if not content_parts:
            content_parts.append(result_text.strip())

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

    async def _search_with_category(
        self, lightrag, query_text: str, category: str, top_k: int, user_id: str
    ) -> list[dict]:
        """Search LightRAG with structured results, then filter by category."""
        from lightrag.base import QueryParam

        param = QueryParam(
            mode="naive",
            only_need_context=True,
            top_k=settings.rag_chunk_top_k,
            chunk_top_k=settings.rag_chunk_top_k,
            enable_rerank=False,
        )

        try:
            data_result = await lightrag.aquery_data(query_text, param=param)
        except Exception as e:
            print(f"[RAG-Anything] aquery_data error: {e}")
            return []

        chunks = []
        if data_result.get("status") == "success":
            chunks = data_result.get("data", {}).get("chunks", [])

        if not chunks:
            return []

        cat_map = self._build_category_map()

        matched = []
        for c in chunks:
            fp = c.get("file_path", "")
            chunk_cat = cat_map.get(fp, "")
            if chunk_cat == category:
                matched.append(c)

        if not matched:
            return []

        seen = set()
        results = []
        for c in matched:
            text = c.get("content", "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            fp = c.get("file_path", "")
            file_name = Path(fp).name if fp else "知识库"
            results.append({
                "text": text,
                "file_name": file_name,
                "category": category,
                "score": 1.0,
            })
            if len(results) >= top_k:
                break

        return results

    async def search_text(
        self, query_text: str, category: str | None = None, top_k: int = 5,
        user_id: str = "default"
    ) -> list[dict]:
        return await self.search(query_text, category=category, top_k=top_k, user_id=user_id)

    async def stats(self, user_id: str = "default") -> dict:
        await self._ensure_ready(user_id)
        return self._rags[user_id].get_config_info() if user_id in self._rags else {}

    async def remove_file(self, doc_id: str, user_id: str = "default") -> bool:
        await self._ensure_ready(user_id)
        # RAGAnything doesn't expose a direct remove API through its public interface.
        # We log it for now.
        print(f"[RAG-Anything] File removal requested for {doc_id} (not yet implemented)")
        return True


rag = RAGEngineAdapter()

_doc_id_map: dict[str, str] = {}
