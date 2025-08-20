// gtfs-loader.js - Dynamic GTFS file loader
const fs = require('fs');
const path = require('path');
const https = require('https');
const { parse } = require('csv-parse/sync');

class GTFSLoader {
  constructor() {
    this.staticDir = process.env.STATIC_GTFS_DIR || path.join(__dirname, '../static-gtfs');
    this.useRemoteFiles = process.env.USE_REMOTE_GTFS === 'true';
    this.fileUrls = {
      'stops.txt': process.env.GTFS_STOPS_URL || '',
      'routes.txt': process.env.GTFS_ROUTES_URL || '',
      'stop_times.txt': process.env.GTFS_STOP_TIMES_URL || ''
    };
  }

  async downloadFile(url, localPath) {
    return new Promise((resolve, reject) => {
      // For Google Drive large files, try direct usercontent URL first
      const fileIdMatch = url.match(/id=([^&]+)/);
      if (fileIdMatch && url.includes('drive.google.com')) {
        const fileId = fileIdMatch[1];
        const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
        console.log(`Trying direct Google Drive download: ${directUrl}`);
        
        // Try direct download first
        this.downloadFileSimple(directUrl, localPath)
          .then(resolve)
          .catch((error) => {
            console.log(`Direct download failed: ${error.message}, trying original URL...`);
            // Fallback to original URL with HTML parsing
            this.downloadFileWithHtmlParsing(url, localPath).then(resolve).catch(reject);
          });
        return;
      }
      
      // For non-Google Drive URLs, use simple download
      this.downloadFileSimple(url, localPath).then(resolve).catch(reject);
    });
  }

  async downloadFileSimple(url, localPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      
      const handleResponse = (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`Following redirect to: ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', reject);
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      };
      
      https.get(url, handleResponse).on('error', reject);
    });
  }

  async downloadFileWithHtmlParsing(url, localPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      
      const handleResponse = (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        // Check if this is HTML
        let isHtmlResponse = false;
        let htmlBuffer = '';
        
        response.on('data', (chunk) => {
          if (!isHtmlResponse) {
            const chunkStr = chunk.toString();
            if (chunkStr.includes('<!DOCTYPE html>') || chunkStr.includes('<html')) {
              isHtmlResponse = true;
              htmlBuffer = chunkStr;
              console.log('Detected HTML response, parsing...');
              return;
            }
          }
          
          if (isHtmlResponse) {
            htmlBuffer += chunk.toString();
            return;
          }
          
          file.write(chunk);
        });
        
        response.on('end', () => {
          if (isHtmlResponse) {
            file.close();
            fs.unlinkSync(localPath);
            reject(new Error('Received HTML instead of file content'));
            return;
          }
          
          file.end();
        });
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
      };
      
      https.get(url, handleResponse).on('error', reject);
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
    if (this.useRemoteFiles && this.fileUrls[filename]) {
      const remoteUrl = this.fileUrls[filename];
      console.log(`Downloading ${filename} from Google Drive...`);
      
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
