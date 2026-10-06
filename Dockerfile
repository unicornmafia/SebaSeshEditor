# syntax=docker/dockerfile:1.7
# Build with the hieropy checkout as a named context, e.g.
#   docker build --build-context hieropy=../hieropy -t sebasesh .
# (docker compose passes it automatically, see docker-compose.yml.)

FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
# hieropy imports tkinter at package import time (for its desktop editor).
RUN apt-get update && apt-get install -y --no-install-recommends tk && rm -rf /var/lib/apt/lists/*
COPY --from=hieropy pyproject.toml README.md LICENSE MANIFEST.in /hieropy/
COPY --from=hieropy src /hieropy/src
RUN pip install --no-cache-dir /hieropy
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/fonts ./fonts

FROM backend AS test
COPY backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY backend/tests ./tests
CMD ["pytest", "-q"]

FROM backend AS runtime
COPY --from=frontend /frontend/dist ./static
RUN useradd --create-home --uid 1000 sebasesh
USER sebasesh
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
