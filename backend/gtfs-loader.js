// gtfs-loader.js - Dynamic GTFS file loader
const fs = require('fs');
const path = require('path');
const https = require('https');
const { parse } = require('csv-parse/sync');

class GTFSLoader {
  constructor() {
    this.staticDir = process.env.STATIC_GTFS_DIR || path.join(__dirname, '../static-gtfs');
    this.githubRawBase = process.env.GITHUB_RAW_BASE || '';
    this.useRemoteFiles = process.env.USE_REMOTE_GTFS === 'true';
  }

  async downloadFile(url, localPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', reject);
    });
  }

  async ensureFile(filename) {
    const localPath = path.join(this.staticDir, filename);
    
    // If file exists locally, use it
    if (fs.existsSync(localPath)) {
      console.log(`Using local file: ${filename}`);
      return localPath;
    }

    // If remote loading is enabled, try to download
    if (this.useRemoteFiles && this.githubRawBase) {
      const remoteUrl = `${this.githubRawBase}/${filename}`;
      console.log(`Downloading ${filename} from GitHub...`);
      
      try {
        // Ensure directory exists
        fs.mkdirSync(this.staticDir, { recursive: true });
        
        await this.downloadFile(remoteUrl, localPath);
        console.log(`Downloaded: ${filename}`);
        return localPath;
      } catch (error) {
        console.warn(`Failed to download ${filename}:`, error.message);
      }
    }

    throw new Error(`File not found: ${filename}`);
  }

  async readCSVSync(filename) {
    try {
      const filePath = await this.ensureFile(filename);
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw, { columns: true, skip_empty_lines: true });
    } catch (error) {
      console.warn(`Warning: ${filename} not found or unreadable`);
      return [];
    }
  }

  async loadAllFiles() {
    console.log('Loading GTFS files...');
    
    const [stops, stopTimes, routes] = await Promise.all([
      this.readCSVSync('stops.txt'),
      this.readCSVSync('stop_times.txt'),
      this.readCSVSync('routes.txt')
    ]);

    console.log(`Loaded: ${stops.length} stops, ${stopTimes.length} stop_times, ${routes.length} routes`);
    
    return { stops, stopTimes, routes };
  }
}

module.exports = GTFSLoader;
