FROM node:18-slim

WORKDIR /app

# Копируем только backend (фронтенд нам не нужен для бэкенд-сервиса)
COPY backend ./backend

# Устанавливаем зависимости
WORKDIR /app/backend
RUN npm install

# Открываем порт
EXPOSE 8080

# Запускаем сервер
CMD ["npm", "run", "start:langchain"]
