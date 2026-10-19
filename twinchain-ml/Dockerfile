FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Solo lo que usa el servicio: el entrenamiento, los tests y la validación NO van en la imagen.
COPY api.py features.py ./
COPY model ./model

# Render y otras plataformas inyectan $PORT.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
