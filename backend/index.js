import fetch from 'node-fetch';
import http from 'http';
import { readFile } from 'fs';
import pkg from 'gtfs-realtime-bindings';
const { transit_realtime } = pkg;

const FEED_URL = 'https://cdn.mbta.com/realtime/TripUpdates.pb';
const PORT = process.env.PORT || 3000;

function formatTimestamp(unixTime) {
  if (!unixTime) return null;
  const date = new Date(unixTime * 1000);
  return date.toLocaleString();
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return readFile('index.html', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Failed to load HTML');
      } else {
        res.end(data);
      }
    });
  }

  if (req.url === '/data') {
    try {
      const response = await fetch(FEED_URL);
      const buffer = await response.arrayBuffer();
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

      const trips = feed.entity
        .filter((e) => e.tripUpdate)
        .flatMap((e) => {
          const stopTimeUpdates = e.tripUpdate.stopTimeUpdate || [];
          return stopTimeUpdates.map((s) => ({
            routeId: e.tripUpdate.trip.routeId,
            tripId: e.tripUpdate.trip.tripId,
            stopId: s.stopId,
            delay: s.departure?.delay || null,
            departureTime: s.departure?.time || null,
            departureFormatted: formatTimestamp(s.departure?.time),
            arrivalTime: s.arrival?.time || null,
            arrivalFormatted: formatTimestamp(s.arrival?.time),
          }));
        });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(trips, null, 2));
    } catch (err) {
      console.error('Fetch or decode failed:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to load GTFS-RT feed' }));
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🚍 Decoder API running at http://localhost:${PORT}`);
});
