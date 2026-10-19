FROM node:20-slim

# Instala dependências do Chromium para execução em Linux/Docker
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libnss3 \
    libxss1 \
    libasound2 \
    ca-certificates \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configura o caminho do Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=3000

WORKDIR /app

# Copia arquivos de dependência
COPY package*.json ./
RUN npm ci --only=production

# Copia código fonte
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
