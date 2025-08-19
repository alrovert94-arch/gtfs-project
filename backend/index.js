// index.js - GTFS-RT parser & API
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const cors = require('cors');

const app = express();
// app.use(cors());
const cors = require('cors');

app.use(cors({
  origin: [
    'http://localhost:3001',
    'https://https://gtfs-king-george.netlify.app',
    // 'https://your-custom-domain.com' // if using custom domain
  ],
  credentials: true
}));


const STATIC_DIR = process.env.STATIC_GTFS_DIR || path.join(__dirname, '../static-gtfs');
const PORT = process.env.PORT || 3000;

// Feed URLs - override with env vars if needed
const TRIPUPDATES_URL = process.env.TRIPUPDATES_URL || 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates';
const VEHICLEPOS_URL = process.env.VEHICLEPOS_URL || 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions';

// In-memory caches
let tripUpdatesCache = { ts: 0, entities: [] };
let vehiclesCache = { ts: 0, entities: [] };

// function readCSVSync(filePath) {
//   const raw = fs.readFileSync(filePath, 'utf8');
//   return parse(raw, { columns: true, skip_empty_lines: true });
// }

// console.log('Loading static GTFS from', STATIC_DIR);

// // Load static GTFS files
// let stops = [], stopTimes = [], routes = [];
// try {
//   stops = readCSVSync(path.join(STATIC_DIR, 'stops.txt'));
// } catch (e) {
//   console.warn('Warning: stops.txt not found or unreadable in', STATIC_DIR);
// }
// try {
//   stopTimes = readCSVSync(path.join(STATIC_DIR, 'stop_times.txt'));
// } catch (e) {
//   console.warn('Warning: stop_times.txt not found or unreadable in', STATIC_DIR);
// }
// try {
//   routes = readCSVSync(path.join(STATIC_DIR, 'routes.txt'));
// } catch (e) {
//   console.warn('Warning: routes.txt not found or unreadable in', STATIC_DIR);
// }


// Replace the existing file loading section (lines ~23-46) with:

const GTFSLoader = require('./gtfs-loader');

// Initialize GTFS loader
const gtfsLoader = new GTFSLoader();

// Global variables for GTFS data
let stops = [], stopTimes = [], routes = [];

// Load GTFS data asynchronously
async function initializeGTFS() {
  try {
    const data = await gtfsLoader.loadAllFiles();
    stops = data.stops;
    stopTimes = data.stopTimes;
    routes = data.routes;
    
    // Build helper maps (keep existing code)
    stops.forEach(s => {
      stopNameById[s.stop_id] = s.stop_name;
      if (s.parent_station) {
        if (!parentStationMap[s.parent_station]) {
          parentStationMap[s.parent_station] = [];
        }
        parentStationMap[s.parent_station].push(s.stop_id);
      }
    });

    routes.forEach(r => {
      routeNameById[r.route_id] = (r.route_short_name ? r.route_short_name + ' ' : '') + (r.route_long_name || '');
    });

    console.log('GTFS data loaded successfully');
  } catch (error) {
    console.error('Failed to load GTFS data:', error);
    // Continue with empty data - app will show demo mode
  }
}

// Initialize GTFS data on startup
initializeGTFS();

// Build helper maps
const stopNameById = {};
const parentStationMap = {}; // parent_station -> [stop_id]
stops.forEach(s => {
  stopNameById[s.stop_id] = s.stop_name || s.stop_desc || '';
  if (s.parent_station && s.parent_station.trim()) {
    parentStationMap[s.parent_station] = parentStationMap[s.parent_station] || [];
    parentStationMap[s.parent_station].push(s.stop_id);
  }
});

// Map for scheduled times: (trip_id|stop_id) -> departure_time string
const scheduledByTripStop = {};
stopTimes.forEach(st => {
  const key = `${st.trip_id}|${st.stop_id}`;
  scheduledByTripStop[key] = st.departure_time || st.arrival_time || null;
});

// route name map
const routeNameById = {};
routes.forEach(r => {
  routeNameById[r.route_id] = (r.route_short_name ? r.route_short_name + ' ' : '') + (r.route_long_name || '');
});

// helper: fetch and decode GTFS-RT feed (with naive caching)
async function fetchGtfsRt(url, cacheObj, ttlSeconds = 240) { // Cache for 4 minutes (240 seconds)
  const now = Date.now();
  if (cacheObj.ts && (now - cacheObj.ts) < ttlSeconds * 1000) {
    return cacheObj.entities;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch error ${res.status} ${res.statusText} for ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // const feed = GtfsRealtimeBindings.FeedMessage.decode(buffer);
  // cacheObj.ts = now;
  // cacheObj.entities = feed.entity || [];
  // return cacheObj.entities;
    // --- robust decode that handles both module shapes ---
  let feed;
  try {
    // Common shapes:
    // 1) GtfsRealtimeBindings.FeedMessage.decode(buffer)
    // 2) GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer)
    if (GtfsRealtimeBindings && GtfsRealtimeBindings.FeedMessage && typeof GtfsRealtimeBindings.FeedMessage.decode === 'function') {
      feed = GtfsRealtimeBindings.FeedMessage.decode(buffer);
    } else if (GtfsRealtimeBindings && GtfsRealtimeBindings.transit_realtime && GtfsRealtimeBindings.transit_realtime.FeedMessage && typeof GtfsRealtimeBindings.transit_realtime.FeedMessage.decode === 'function') {
      feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    } else {
      // Diagnostic log to help debugging the module shape if neither worked
      console.error('gtfs-realtime-bindings module keys:', Object.keys(GtfsRealtimeBindings || {}));
      if (GtfsRealtimeBindings && GtfsRealtimeBindings.transit_realtime) {
        console.error('gtfs-realtime-bindings.transit_realtime keys:', Object.keys(GtfsRealtimeBindings.transit_realtime));
      }
      throw new Error('FeedMessage.decode not found on gtfs-realtime-bindings. See logs for module shape.');
    }
  } catch (errDecode) {
    console.error('Error decoding GTFS-RT feed:', errDecode && (errDecode.stack || errDecode.message) || errDecode);
    throw errDecode;
  }

  cacheObj.ts = now;
  cacheObj.entities = feed.entity || [];
  return cacheObj.entities;

}

// API: health
// app.get('/health', (req, res) => {
//   res.json({ ok: true, time: new Date().toISOString() });
// });
// Add this route in index.js
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    gtfsLoaded: {
      stops: stops.length,
      stopTimes: stopTimes.length,
      routes: routes.length
    }
  });
});


// API: station
// Example: /station/place_kgbs?count=20
app.get('/station/:stationId', async (req, res) => {
  try {
    const stationId = req.params.stationId;
    const count = parseInt(req.query.count || '20', 10);

    // Resolve stop_id set for the station:
    // 1) If the stationId is a parent_station, use its children
    // 2) Also include the stationId itself (sometimes feeds use parent id)
    const childStops = new Set();
    if (parentStationMap[stationId]) {
      parentStationMap[stationId].forEach(sid => childStops.add(sid));
    }
    childStops.add(stationId); // include the id itself

    // fetch TripUpdates
    const tripEntities = await fetchGtfsRt(TRIPUPDATES_URL, tripUpdatesCache);

    const results = [];

    for (const entity of tripEntities) {
      if (!entity.tripUpdate) continue;
      const tu = entity.tripUpdate;
      const tripId = tu.trip && tu.trip.tripId ? tu.trip.tripId : null;
      const routeId = tu.trip && tu.trip.routeId ? tu.trip.routeId : null;
      const headsign = tu.trip && tu.trip.tripHeadSign ? tu.trip.trip.tripHeadSign : (tu.trip && tu.trip.trip_headsign) || null;

      const stopTimeUpdates = tu.stopTimeUpdate || tu.stop_time_update || [];

      for (const stu of stopTimeUpdates) {
        // stop id can be in either field names depending on parser
        const stopId = stu.stopId || stu.stop_id || stu.stop_id || null;
        if (!stopId) continue;
        if (!childStops.has(stopId)) continue;

        // predicted times (from feed)
        const arrivalObj = stu.arrival || stu.arrival || null;
        const departureObj = stu.departure || stu.departure || null;

        let predictedTs = null;
        let predictedType = null;
        if (arrivalObj && arrivalObj.time) {
          predictedTs = Number(arrivalObj.time) * 1000;
          predictedType = 'arrival';
        } else if (departureObj && departureObj.time) {
          predictedTs = Number(departureObj.time) * 1000;
          predictedType = 'departure';
        }

        // scheduled time (from static stop_times if available)
        const scheduled = scheduledByTripStop[`${tripId}|${stopId}`] || null;

        // compute status/ delay text if we have both
        let status = 'Scheduled';
        if (predictedTs && scheduled) {
          // scheduled is like "14:35:00" in Brisbane timezone
          const [h, m, s] = scheduled.split(':').map(x => parseInt(x, 10));
          let scheduledHour = isNaN(h) ? 0 : h;
          
          // Get today's date in Brisbane timezone
          const today = new Date();
          const brisbaneOffset = 10 * 60; // Brisbane is UTC+10 (600 minutes)
          
          // Create scheduled time assuming it's in Brisbane timezone
          // First create it as if it's UTC, then adjust for Brisbane offset
          let scheduledDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), scheduledHour % 24, m || 0, s || 0));
          
          // Handle 24+ hour stops (some GTFS use 25:xx for after midnight)
          if (scheduledHour >= 24) {
            scheduledDate.setUTCDate(scheduledDate.getUTCDate() + 1);
          }
          
          // Adjust for Brisbane timezone (subtract 10 hours to convert Brisbane time to UTC)
          const scheduledMs = scheduledDate.getTime() - (brisbaneOffset * 60 * 1000);
          
          const delaySeconds = Math.round((predictedTs - scheduledMs) / 1000);
          if (delaySeconds > 60) status = `Delayed +${Math.round(delaySeconds/60)}m`;
          else if (delaySeconds < -60) status = `Early ${Math.round(-delaySeconds/60)}m`;
          else status = 'On time';
        } else if (tu.delay) {
          status = (tu.delay > 0) ? `Delayed ${Math.round(tu.delay/60)}m` : 'On time';
        }

        results.push({
          tripId,
          routeId,
          routeName: routeNameById[routeId] || routeId || null,
          headsign: headsign || (tu.trip && tu.trip.trip_headsign) || null,
          stopId,
          stopName: stopNameById[stopId] || null,
          scheduled: scheduled, // as HH:MM:SS string (may be null)
          predicted: predictedTs ? new Date(predictedTs).toISOString() : null,
          predictedLocal: predictedTs ? new Date(predictedTs).toLocaleString() : null,
          predictedEpochMs: predictedTs || null,
          type: predictedType || 'unknown',
          status
        });
      }
    }

    // sort by predicted time if available; fall back to scheduled string
    results.sort((a, b) => {
      if (a.predictedEpochMs && b.predictedEpochMs) return a.predictedEpochMs - b.predictedEpochMs;
      if (a.predictedEpochMs) return -1;
      if (b.predictedEpochMs) return 1;
      // fallback: compare scheduled strings
      if (a.scheduled && b.scheduled) return a.scheduled.localeCompare(b.scheduled);
      return 0;
    });

    res.json({ stationId, count: results.length, results: results.slice(0, count), fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in /station handler:', err && err.stack || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// --- Add at bottom of backend/index.js (after /station route) ---

const DATA_DIR = path.join(__dirname, '../data');

// helper: convert protobuf entity to plain JS object (safe to JSON.stringify)
function normalizeEntity(entity) {
  const out = {};
  if (entity.tripUpdate) {
    out.type = 'tripUpdate';
    const tu = entity.tripUpdate;
    out.trip = {
      tripId: tu.trip?.tripId || null,
      routeId: tu.trip?.routeId || null,
      tripHeadSign: (tu.trip && (tu.trip.tripHeadSign || tu.trip.trip_headsign)) || null,
    };
    out.stopTimeUpdates = (tu.stopTimeUpdate || tu.stop_time_update || []).map(stu => ({
      stopId: stu.stopId || stu.stop_id || null,
      arrival: stu.arrival ? { time: Number(stu.arrival.time || 0), delay: stu.arrival.delay || null } : null,
      departure: stu.departure ? { time: Number(stu.departure.time || 0), delay: stu.departure.delay || null } : null,
      scheduleRelationship: stu.scheduleRelationship || stu.schedule_relationship || null
    }));
  } else if (entity.vehicle) {
    out.type = 'vehicle';
    const v = entity.vehicle;
    out.vehicle = {
      id: v.vehicle?.vehicle?.id || null,
      label: v.vehicle?.vehicle?.label || null,
      trip: v.trip || null,
      position: v.position || null,
    };
  } else if (entity.alert) {
    out.type = 'alert';
    out.alert = entity.alert;
  }
  return out;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const stationDir = path.join(DATA_DIR, 'stations');
  if (!fs.existsSync(stationDir)) fs.mkdirSync(stationDir, { recursive: true });
}

// POST/GET /refresh?stations=place_kgbs,place_xxx
// If stations param present generate per-station snapshots (comma-separated).
app.get('/refresh', async (req, res) => {
  try {
    // force immediate fetch (ttlSeconds = 0)
    const entities = await fetchGtfsRt(TRIPUPDATES_URL, tripUpdatesCache, 0);

    // normalize into plain JS
    const plain = entities.map(e => normalizeEntity(e));

    ensureDataDir();

    // write raw normalized feed
    const fpath = path.join(DATA_DIR, `tripupdates.json`);
    fs.writeFileSync(fpath, JSON.stringify({ fetchedAt: new Date().toISOString(), entities: plain }, null, 2));

    // optionally make station snapshots
    const stationsParam = req.query.stations; // e.g. ?stations=place_kgbs,place_xxx
    const stationsList = stationsParam ? stationsParam.split(',').map(s => s.trim()).filter(Boolean) : null;

    // if there's a backend config file with stations, prefer that if no ?stations param
    let configuredStations = [];
    try {
      const cfgPath = path.join(__dirname, 'stations.json');
      if (fs.existsSync(cfgPath)) {
        configuredStations = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch (err) {
      console.error('Failed parsing stations.json', err);
    }

    const toSnapshot = stationsList || (configuredStations.length ? configuredStations : []);

    // helper to filter by stationId (uses previously built parentStationMap)
    const snapshotResults = {};
    if (toSnapshot.length) {
      for (const stationId of toSnapshot) {
        // resolve child stop ids:
        const childStops = new Set();
        if (parentStationMap[stationId]) parentStationMap[stationId].forEach(sid => childStops.add(sid));
        childStops.add(stationId);

        // build station results using the same logic as /station route but based on the normalized entities
        const results = [];
        for (const ent of plain) {
          if (ent.type !== 'tripUpdate') continue;
          const trip = ent.trip || {};
          const stuList = ent.stopTimeUpdates || [];
          for (const stu of stuList) {
            if (!stu.stopId) continue;
            if (!childStops.has(stu.stopId)) continue;
            // derive a minimal record
            results.push({
              tripId: trip.tripId,
              routeId: trip.routeId,
              headsign: trip.tripHeadSign || null,
              stopId: stu.stopId,
              scheduled: null,   // scheduled by trip/stop not included in normalized feed; /station route still resolves it on-the-fly
              predictedEpochSec: (stu.arrival && stu.arrival.time) || (stu.departure && stu.departure.time) || null,
              type: (stu.arrival && 'arrival') || (stu.departure && 'departure') || 'unknown'
            });
          }
        }
        // sort
        results.sort((a,b) => (a.predictedEpochSec||0) - (b.predictedEpochSec||0));
        snapshotResults[stationId] = results;
        const sPath = path.join(DATA_DIR, 'stations', `${stationId}.json`);
        fs.writeFileSync(sPath, JSON.stringify({ stationId, generatedAt: new Date().toISOString(), results }, null, 2));
      }
    }

    res.json({ ok: true, written: { raw: fpath, snapshots: Object.keys(snapshotResults) }, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in /refresh:', err && (err.stack || err.message) || err);
    res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

// simple endpoint to return the raw normalized feed file
app.get('/raw', (req, res) => {
  try {
    ensureDataDir();
    const fpath = path.join(DATA_DIR, `tripupdates.json`);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'no raw feed saved' });
    res.sendFile(fpath);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// list configured or available parent stations (useful UI)
app.get('/stations-list', (req, res) => {
  try {
    // return parent stations (keys of parentStationMap) with friendly names if available
    const list = Object.keys(parentStationMap || {}).map(ps => {
      // find name by looking up a child's stop_name or use ps
      const children = parentStationMap[ps] || [];
      const name = (children.length && stopNameById[children[0]]) || ps;
      return { stationId: ps, name };
    });
    res.json({ count: list.length, stations: list });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});


app.listen(PORT, () => {
  console.log(`GTFS-RT parser listening on port ${PORT}`);
  console.log(`TripUpdates source: ${TRIPUPDATES_URL}`);
});
