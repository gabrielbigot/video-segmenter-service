FROM node:18-slim

# Installer FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de l'application
WORKDIR /usr/src/app

# Copier le package.json et package-lock.json
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier les fichiers de l'application
COPY . .

# Créer et donner les permissions au dossier temp
RUN mkdir -p /usr/src/app/temp && chmod 777 /usr/src/app/temp

# Exposer le port
EXPOSE 8080

# Démarrer l'application
CMD [ "node", "index.js" ]

