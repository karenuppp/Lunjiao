"""
Backend verification script — run after pip install completes.
"""
import sys
import importlib

modules = [
    "fastapi", "uvicorn", "pydantic",
    "pandas", "langchain", "langgraph",
    "mcp", "matplotlib", "plotly",
    "httpx",
]

missing = []
for mod in modules:
    try:
        importlib.import_module(mod)
        print(f"  ✅ {mod}")
    except ImportError:
        missing.append(mod)
        print(f"  ❌ {mod}")

if missing:
    print(f"\nMissing: {', '.join(missing)}")
    sys.exit(1)
else:
    print("\n✅ All core modules installed successfully!")
