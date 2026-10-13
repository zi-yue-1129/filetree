# FileNexus backend image (API only; the frontend is hosted on Cloudflare Pages).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/

# Persistent state (databases, uploads, tus temp files) lives under /app/data.
# Pre-create it owned by the default runtime UID so an empty named volume
# (used on Windows hosts, see deploy/windows/) inherits writable ownership.
RUN mkdir -p /app/data && chown 1000:1000 /app/data
VOLUME ["/app/data"]
EXPOSE 5168

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:5168/docs', timeout=4)"

# --proxy-headers lets request.base_url honour X-Forwarded-Proto/Host from
# Cloudflare Tunnel, so TUS "Location" headers are emitted as https URLs.
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "5168", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-keep-alive", "60"]
