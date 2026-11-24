# The Pono server template (D-034): Agent37's Claude Code image, plus what a Pono project uses at
# once: pnpm, Spec Kit, a Postgres client and a browser for tests and screenshots. Everything goes
# under /usr/local or /opt: /home/node is the server's own disk, masked at runtime.
FROM ghcr.io/agent37-platform/claude-code:2026.11.11a

USER root
ENV COREPACK_HOME=/opt/corepack \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# pnpm: version 10 ready, and the version a project pins in packageManager fetched by corepack.
RUN npm install -g pnpm@10.20.0 \
 && mkdir -p /opt/corepack && chmod -R a+rwX /opt/corepack

# Spec Kit: `specify init` and the /speckit commands the templates ship with.
RUN uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.16.0 \
 && chmod -R a+rX /opt/uv-tools

# A browser for the agent's tests and screenshots of the preview. Python's Playwright goes to the
# system Python: the server's own venv (~/.venv) lives on its disk, masked at runtime. The import
# is checked here, so that a broken image never builds.
RUN npx --yes playwright@1.56.1 install --with-deps chromium \
 && /usr/bin/python3 -m pip install --no-cache-dir --break-system-packages playwright==1.56.0 \
 && /usr/bin/python3 -c "import playwright.sync_api" \
 && chmod -R a+rX /opt/ms-playwright

RUN mkdir -p /usr/local/share/pono && echo "pono-web 4" > /usr/local/share/pono/version
USER node
