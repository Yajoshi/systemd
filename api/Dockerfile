FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --omit=dev
COPY index.js ./
EXPOSE 8443
CMD ["node","index.js"]
