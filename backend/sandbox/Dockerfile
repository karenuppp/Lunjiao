FROM python:3.12-slim

# Create non-root user for execution
RUN groupadd -r sandbox -g 1000 && \
    useradd -r -g sandbox -u 1000 -m -s /bin/bash sandbox

# Install Python packages (must match versions used by the project)
RUN pip install --no-cache-dir \
    pandas>=2.3.3 \
    "numpy>=1.26.4,<2" \
    matplotlib==3.10.0 \
    plotly==5.24.1 \
    openpyxl==3.1.5 \
    tabulate==0.9.0 \
    python-docx>=1.1.2

# Set matplotlib to non-interactive backend
ENV MPLBACKEND=Agg

# Install Chinese fonts for matplotlib charts and python-docx rendering
COPY fonts/ /usr/share/fonts/truetype/zh-cn/
RUN fc-cache -f /usr/share/fonts/truetype/zh-cn/ 2>/dev/null; \
    python -c "import matplotlib; matplotlib.font_manager._load_fontmanager(try_read_cache=False)" 2>/dev/null; \
    rm -rf /root/.cache/matplotlib /home/sandbox/.cache/matplotlib 2>/dev/null; \
    true

# Create writable directory for temp files and output
RUN mkdir -p /tmp/sandbox /sandbox/output && chown sandbox:sandbox /tmp/sandbox /sandbox/output

# Copy the runner script
COPY runner.py /sandbox/runner.py

# Working dir owned by sandbox user
WORKDIR /sandbox

# Switch to non-root user
USER sandbox

ENTRYPOINT ["python", "/sandbox/runner.py"]
