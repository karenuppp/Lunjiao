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
    tabulate==0.9.0

# Set matplotlib to non-interactive backend
ENV MPLBACKEND=Agg

# Create writable directory for temp files
RUN mkdir -p /tmp/sandbox && chown sandbox:sandbox /tmp/sandbox

# Copy the runner script
COPY runner.py /sandbox/runner.py

# Working dir owned by sandbox user
WORKDIR /sandbox

# Switch to non-root user
USER sandbox

ENTRYPOINT ["python", "/sandbox/runner.py"]
