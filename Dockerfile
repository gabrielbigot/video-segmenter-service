FROM node:18-slim

WORKDIR /usr/src/app

# Installation des dépendances
COPY package*.json ./
RUN npm install

# Copie des fichiers sources
COPY . .

# Installation de FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Création du répertoire temporaire avec les bonnes permissions
RUN mkdir -p /usr/src/app/temp && \
    chmod 777 /usr/src/app/temp && \
    # Créer également un répertoire de secours au cas où
    mkdir -p /tmp/segmenter && \
    chmod 777 /tmp/segmenter

# Exposition du port
EXPOSE 8080

# Démarrage de l'application
CMD ["node", "index.js"]


