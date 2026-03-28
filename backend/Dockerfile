FROM python:3.12-slim

# 최소 패키지만 설치 (Tesseract 제거 → Claude API로 OCR 처리)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /app/uploads/contracts

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
