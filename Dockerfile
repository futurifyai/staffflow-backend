FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
COPY ../../pnpm-workspace.yaml ../../pnpm-lock.yaml ./

COPY . .

RUN pnpm install --ignore-scripts
RUN pnpm run build

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]