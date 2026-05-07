#!/usr/bin/env python3
"""Test LangGraph compatibility."""
from langgraph.prebuilt import create_react_agent
print("create_react_agent OK")
print(f"langgraph version: ", end="")
import langgraph; print(langgraph.__version__)
