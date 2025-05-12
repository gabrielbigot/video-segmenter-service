import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Variables d'environnement Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const apiKey = process.env.API_KEY; // Clé pour sécuriser l'API

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Vérification de la clé API
const verifyApiKey = (req, res, next) => {
  const providedApiKey = req.headers['x-api-key'];
  if (!apiKey || providedApiKey !== apiKey) {
    console.error(`Accès non autorisé - Clé API invalide. Reçu: ${providedApiKey}, Attendu: ${apiKey}`);
    return res.status(403).json({ error: 'Accès non autorisé' });
  }
  next();
};

// Fonction pour exécuter FFmpeg avec transcodage en VP8 et Opus
const runFFmpeg = (inputPath, outputPattern, segmentDuration) => {
  return new Promise((resolve, reject) => {
    console.log(`Running FFmpeg: input=${inputPath}, output=${outputPattern}, duration=${segmentDuration}`);
    
    const args = [
      '-i', inputPath,
      '-c:v', 'libvpx',     // Transcoder la vidéo en VP8 (compatible avec WebM)
      '-c:a', 'libopus',    // Convertir l'audio en Opus (compatible avec WebM)
      '-b:a', '128k',       // Définir un bitrate audio (optionnel, ajustable selon tes besoins)
      '-map', '0',
      '-f', 'segment',
      '-segment_time', segmentDuration.toString(),
      outputPattern
    ];
    
    console.log(`Command: ffmpeg ${args.join(' ')}`);
    
    const process = spawn('ffmpeg', args);
    let stdoutData = '';
    let stderrData = '';
    
    process.stdout.on('data', data => {
      stdoutData += data.toString();
    });
    
    process.stderr.on('data', data => {
      stderrData += data.toString();
    });
    
    process.on('close', code => {
      if (code !== 0) {
        console.error(`FFmpeg error (code ${code}):`, stderrData);
        reject(new Error(`FFmpeg failed with code ${code}: ${stderrData}`));
      } else {
        console.log('FFmpeg completed successfully');
        resolve(stdoutData);
      }
    });
  });
};

// Route pour la segmentation
app.post('/segment', verifyApiKey, async (req, res) => {
  console.log('Segmentation request received');
  
  try {
    const { bucket, path: videoPath, segmentDuration = 120 } = req.body;
    
    if (!bucket || !videoPath) {
      console.error("Paramètres manquants dans la requête: bucket et path sont requis");
      return res.status(400).json({ error: "Les paramètres 'bucket' et 'path' sont requis" });
    }
    
    console.log(`Request params: bucket=${bucket}, path=${videoPath}, segmentDuration=${segmentDuration}`);
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Configuration Supabase manquante dans les variables d'environnement");
      return res.status(500).json({ error: "Configuration Supabase manquante" });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Supabase client initialized');
    
    // Télécharger la vidéo
    console.log(`Downloading video from ${bucket}/${videoPath}`);
    const { data, error } = await supabase.storage.from(bucket).download(videoPath);
    
    if (error || !data) {
      console.error('Download error:', error);
      return res.status(500).json({ error: `Erreur téléchargement vidéo: ${error?.message || "inconnue"}` });
    }
    
    console.log('Video downloaded successfully, size:', data.size);
    
    // Créer le répertoire temp s'il n'existe pas
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Sauvegarder le fichier temporairement
    const tempInput = path.join(tempDir, 'input.webm');
    const tempOutputPattern = path.join(tempDir, 'segment_%d.webm');
    
    await fs.writeFile(tempInput, Buffer.from(await data.arrayBuffer()));
    console.log('Temporary input file created:', tempInput);
    
    // Segmenter avec FFmpeg
    try {
      await runFFmpeg(tempInput, tempOutputPattern, segmentDuration);
    } catch (e) {
      console.error('FFmpeg segmentation error:', e);
      return res.status(500).json({ error: `Erreur lors du découpage vidéo: ${e.message}` });
    }
    
    // Upload des segments
    const segments = [];
    let i = 0;
    
    while (true) {
      const segmentPath = path.join(tempDir, `segment_${i}.webm`);
      
      try {
        // Vérifier si le fichier existe
        const stats = await fs.stat(segmentPath);
        console.log(`Segment ${i} exists, size: ${stats.size}`);
        
        // Ignorer les fichiers vides
        if (stats.size === 0) {
          console.log(`Skipping empty segment ${i}`);
          await fs.unlink(segmentPath);
          i++;
          continue;
        }
        
        // Lire le fichier
        const file = await fs.readFile(segmentPath);
        
        // Déterminer le chemin de stockage
        const basePath = videoPath.replace(/\.webm$/i, '');
        const segStoragePath = `${basePath}_segment_${i}.webm`;
        
        console.log(`Uploading segment ${i} to ${bucket}/${segStoragePath}`);
        
        // Upload sur Supabase Storage
        const { error: upErr } = await supabase.storage.from(bucket).upload(
          segStoragePath,
          file,
          { upsert: true, contentType: 'video/webm' }
        );
        
        if (upErr) {
          console.error(`Error uploading segment ${i}:`, upErr);
          throw upErr;
        }
        
        // Ajouter au tableau des segments
        segments.push(segStoragePath);
        console.log(`Segment ${i} uploaded successfully`);
        
        // Supprimer le fichier temporaire
        await fs.unlink(segmentPath);
        
      } catch (e) {
        // Si l'erreur est que le fichier n'existe pas, c'est la fin des segments
        if (e.code === 'ENOENT') {
          console.log(`No more segments found after ${i-1}`);
          break;
        }
        
        // Sinon, remonter l'erreur
        console.error(`Error processing segment ${i}:`, e);
        return res.status(500).json({ error: `Erreur traitement segment ${i}: ${e.message}` });
      }
      
      i++;
    }
    
    // Nettoyer le fichier d'entrée
    try {
      await fs.unlink(tempInput);
    } catch (e) {
      console.log('Failed to delete input file:', e);
    }
    
    console.log(`Segmentation complete: ${segments.length} segments created`);
    return res.json({ segments });
    
  } catch (e) {
    console.error('Segmenter error:', e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
});

// Route de santé
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
