// gtfs-loader.js - Dynamic GTFS file loader
const fs = require('fs');
const path = require('path');
const https = require('https');
const { parse } = require('csv-parse/sync');
const { parse: parseStream } = require('csv-parse');


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

  async downloadFile(url, localPath, filename) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      
      const handleResponse = (response) => {
        // Handle redirects (301, 302, 303, 307, 308)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`Following redirect to: ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', reject);
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        // Check if this is Google Drive virus scan HTML page
        let isHtmlResponse = false;
        let htmlBuffer = '';
        
        response.on('data', (chunk) => {
          if (!isHtmlResponse) {
            const chunkStr = chunk.toString();
            if (chunkStr.includes('<!DOCTYPE html>') || chunkStr.includes('<html')) {
              isHtmlResponse = true;
              htmlBuffer = chunkStr;
              console.log('Detected Google Drive virus scan page, extracting download link...');
              return;
            }
          }
          
          if (isHtmlResponse) {
            htmlBuffer += chunk.toString();
            return;
          }
          
          // Normal file download
          file.write(chunk);
        });
        
        response.on('end', () => {
          if (isHtmlResponse) {
            // Extract the actual download URL from HTML - try multiple patterns
            console.log('Parsing HTML for download link...');
            
            // Pattern 1: Standard href with export=download
            let downloadMatch = htmlBuffer.match(/href="([^"]*export=download[^"]*)"/);
            
            // Pattern 2: Form action with download
            if (!downloadMatch) {
              downloadMatch = htmlBuffer.match(/action="([^"]*download[^"]*)"/);
            }
            
            // Pattern 3: Any usercontent.google.com download link
            if (!downloadMatch) {
              downloadMatch = htmlBuffer.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/);
            }
            
            // Pattern 4: Any URL with the file ID and download
            if (!downloadMatch) {
              const fileIdMatch = url.match(/id=([^&]+)/);
              if (fileIdMatch) {
                const fileId = fileIdMatch[1];
                const actualDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
                console.log(`Using constructed download URL: ${actualDownloadUrl}`);
                file.close();
                fs.unlinkSync(localPath); // Remove empty file
                https.get(actualDownloadUrl, handleResponse).on('error', reject);
                return;
              }
            }
            
            if (downloadMatch) {
              const actualDownloadUrl = downloadMatch[1].replace(/&amp;/g, '&');
              console.log(`Found actual download URL: ${actualDownloadUrl}`);
              file.close();
              fs.unlinkSync(localPath); // Remove empty file
              https.get(actualDownloadUrl, handleResponse).on('error', reject);
              return;
            } else {
              console.log('HTML content preview:', htmlBuffer.substring(0, 500));
              reject(new Error('Could not extract download URL from Google Drive virus scan page'));
              return;
            }
          }
          
          file.end();
        });
        
        file.on('finish', () => {
          file.close();
          
          // Validate downloaded file is actually CSV, not HTML
          try {
            const stats = fs.statSync(localPath);
            const fileSizeBytes = stats.size;
            const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
            
            console.log(`Downloaded file size: ${fileSizeMB}MB (${fileSizeBytes} bytes)`);
            
            // Check minimum file size expectations
            let expectedMinSizeMB = 0.1; // Default 100KB minimum
            if (filename === 'stop_times.txt') {
              expectedMinSizeMB = 100; // Expect at least 100MB for stop_times
            } else if (filename === 'stops.txt') {
              expectedMinSizeMB = 1; // Expect at least 1MB for stops
            } else if (filename === 'routes.txt') {
              expectedMinSizeMB = 0.1; // Expect at least 100KB for routes
            }
            
            if (fileSizeMB < expectedMinSizeMB) {
              console.log(`File too small: ${fileSizeMB}MB < ${expectedMinSizeMB}MB expected - likely HTML redirect page`);
              fs.unlinkSync(localPath); // Remove tiny file
              reject(new Error(`Downloaded file too small (${fileSizeMB}MB) - expected at least ${expectedMinSizeMB}MB`));
              return;
            }
            
            // For large files, skip content validation to prevent memory issues
            if (fileSizeMB > 50) {
              console.log(`Large file (${fileSizeMB}MB) - skipping content validation to prevent memory issues`);
            } else {
              // Only validate smaller files
              const fileContent = fs.readFileSync(localPath, 'utf8');
              const firstLine = fileContent.split('\n')[0];
              
              // Check if it's HTML (virus scan page)
              if (firstLine.includes('<!DOCTYPE html>') || firstLine.includes('<html')) {
                console.log('Downloaded file is HTML virus scan page, not CSV data');
                fs.unlinkSync(localPath); // Remove HTML file
                reject(new Error('Downloaded HTML instead of CSV - Google Drive virus scan blocking'));
                return;
              }
              
              // Check if it's valid CSV header based on file type
              let isValidHeader = false;
              if (filename === 'stop_times.txt') {
                isValidHeader = firstLine.includes('trip_id') && firstLine.includes('stop_id');
              } else if (filename === 'stops.txt') {
                isValidHeader = firstLine.includes('stop_id') && firstLine.includes('stop_name');
              } else if (filename === 'routes.txt') {
                isValidHeader = firstLine.includes('route_id') && firstLine.includes('route_type');
              } else {
                isValidHeader = true; // Unknown file type, assume valid
              }
              
              if (!isValidHeader) {
                console.log(`Downloaded file does not contain expected CSV headers for ${filename}`);
                fs.unlinkSync(localPath); // Remove invalid file
                reject(new Error(`Downloaded file is not valid GTFS ${filename}`));
                return;
              }
            }
            
            console.log('File validation passed - valid CSV data downloaded');
            resolve();
          } catch (error) {
            console.log('Error validating downloaded file:', error.message);
            reject(error);
          }
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
        
        await this.downloadFile(remoteUrl, localPath, filename);
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
      
      // Check file size before parsing
      const stats = fs.statSync(filePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`Parsing ${filename}: ${fileSizeMB}MB`);
      
      // For large files (>50MB), use streaming parser with memory limits
      if (stats.size > 50 * 1024 * 1024) {
        console.log(`Large file detected (${fileSizeMB}MB) - using streaming parser with limits`);
        return await this.parseCSVStreaming(filePath, filename);
      }
      
      // For smaller files, use synchronous parsing
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw, { columns: true, skip_empty_lines: true });
    } catch (error) {
      console.warn(`Warning: ${filename} not found or unreadable:`, error.message);
      return [];
    }
  }

  async parseCSVStreaming(filePath, filename) {
    return new Promise((resolve, reject) => {
      const results = [];
      let rowCount = 0;
      const maxRows = filename === 'stop_times.txt' ? 300000 : 100000; // Reduced limit for memory safety
      let limitReached = false;
      
      console.log(`Streaming parse with HARD LIMIT of ${maxRows} rows for ${filename}`);
      
      const parser = parseStream({ 
        columns: true, 
        skip_empty_lines: true
        // Removed max_records - implementing manual limit
      });
      
      parser.on('readable', function() {
        let record;
        while ((record = parser.read()) && !limitReached) {
          results.push(record);
          rowCount++;
          
          if (rowCount % 50000 === 0) {
            console.log(`Processed ${rowCount} rows of ${filename}...`);
          }
          
          // Manual hard limit enforcement
          if (rowCount >= maxRows) {
            limitReached = true;
            console.log(`HARD LIMIT REACHED: Stopping at ${rowCount} rows to prevent memory issues`);
            parser.destroy(); // Stop parsing immediately
            resolve(results);
            return;
          }
        }
      });
      
      parser.on('end', () => {
        if (!limitReached) {
          console.log(`Completed parsing ${filename}: ${results.length} rows loaded`);
          resolve(results);
        }
      });
      
      parser.on('error', (error) => {
        console.error(`Error parsing ${filename}:`, error.message);
        reject(error);
      });
      
      parser.on('close', () => {
        if (limitReached) {
          console.log(`Parser closed after reaching limit: ${results.length} rows loaded`);
        }
      });
      
      // Create read stream and pipe to parser
      fs.createReadStream(filePath).pipe(parser);
    });
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
