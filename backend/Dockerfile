FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt

COPY backend /app
COPY config /config
ENV CONFIG_PATH=/config/civicpulse.yaml

RUN useradd --create-home --uid 10001 civicpulse && mkdir -p /data/uploads && chown -R civicpulse /data /app
USER civicpulse

EXPOSE 8000
CMD ["sh", "/app/docker/start-api.sh"]
