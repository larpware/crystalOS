FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=5000

EXPOSE 5000

CMD ["sh", "-c", "npm start"]