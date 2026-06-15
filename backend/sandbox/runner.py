"""Sandbox code runner — reads /sandbox/user_code.py, executes, prints JSON result."""

import io
import json
import os
import sys
import traceback

CODE_FILE = "/sandbox/user_code.py"

# Capture all output
captured_stdout = io.StringIO()
captured_stderr = io.StringIO()
sys.stdout = captured_stdout
sys.stderr = captured_stderr

exit_code = 0
error_info = ""

try:
    if not os.path.exists(CODE_FILE):
        print(json.dumps({"ok": False, "stdout": "", "stderr": "", "exit_code": 1, "error": "Code file not found"}))
        sys.exit(1)

    with open(CODE_FILE, "r", encoding="utf-8") as f:
        code = f.read()

    # Compile first to separate syntax errors from runtime errors
    compiled = compile(code, CODE_FILE, "exec")

    exec_globals = {"__builtins__": __builtins__}
    exec(compiled, exec_globals)

except SystemExit as e:
    exit_code = e.code if isinstance(e.code, int) else 1
except SyntaxError as e:
    exit_code = 1
    error_info = f"SyntaxError: {e}"
except Exception:
    exit_code = 1
    error_info = traceback.format_exc()

# Restore real stdout/stderr and emit result
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__

result = {
    "ok": exit_code == 0 and not error_info,
    "stdout": captured_stdout.getvalue(),
    "stderr": captured_stderr.getvalue(),
    "exit_code": exit_code,
    "error": error_info,
}
print(json.dumps(result, ensure_ascii=False))
