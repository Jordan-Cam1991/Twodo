FROM python:3.9-slim

WORKDIR /app

COPY . /app

EXPOSE 5050

ENV PORT=5050

CMD ["python3", "server.py", "5050"]
