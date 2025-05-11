FROM node:18

# Installer FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080
CMD [ "node", "index.js" ]
