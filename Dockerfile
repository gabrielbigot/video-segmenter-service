# Utiliser une image de base plus légère
FROM node:18-slim

# Installer FFmpeg et les dépendances nécessaires pour VP8/VP9
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libvpx-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /usr/src/app

# Copier les fichiers de dépendances et installer
COPY package*.json ./
RUN npm install

# Copier le reste des fichiers de l'application
COPY . .

# Exposer le port utilisé par Google Cloud Run
EXPOSE 8080

# Créer un utilisateur non-root pour exécuter l'application
RUN useradd -m appuser
USER appuser

# Commande pour démarrer l'application
CMD ["node", "index.js"]

