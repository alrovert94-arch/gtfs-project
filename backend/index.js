// index.js - GTFS-RT parser & API
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const cors = require('cors');

// Prevent crashes from uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit - keep service running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - keep service running
});

const app = express();
// app.use(cors());

app.use(cors({
  origin: [
    'http://localhost:3001',
    'https://gtfs-king-george.netlify.app',
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
    
    // Build helper maps with defensive programming
    console.log(`Processing ${stops.length} stops, ${routes.length} routes, ${stopTimes.length} stop_times`);
    
    // Safely process stops
    if (Array.isArray(stops)) {
      stops.forEach((s, index) => {
        try {
          if (s && s.stop_id) {
            stopNameById[s.stop_id] = s.stop_name || s.stop_desc || '';
            if (s.parent_station && s.parent_station.trim()) {
              if (!parentStationMap[s.parent_station]) {
                parentStationMap[s.parent_station] = [];
              }
              parentStationMap[s.parent_station].push(s.stop_id);
            }
          }
        } catch (error) {
          console.warn(`Error processing stop at index ${index}:`, error.message);
        }
      });
    }

    // Safely process routes
    if (Array.isArray(routes)) {
      routes.forEach((r, index) => {
        try {
          if (r && r.route_id) {
            routeNameById[r.route_id] = (r.route_short_name ? r.route_short_name + ' ' : '') + (r.route_long_name || '');
          }
        } catch (error) {
          console.warn(`Error processing route at index ${index}:`, error.message);
        }
      });
    }

    // Safely process stop_times with flexible matching
    if (Array.isArray(stopTimes)) {
      stopTimes.forEach((st, index) => {
        try {
          if (st && st.trip_id && st.stop_id) {
            const key = `${st.trip_id}|${st.stop_id}`;
            scheduledByTripStop[key] = st.departure_time || st.arrival_time || null;
            
            // Create route-based lookup for fallback matching
            // We'll match using route short names from the routes data
            for (const route of routes) {
              if (route.route_short_name && st.trip_id.includes(route.route_short_name)) {
                const routeKey = `${route.route_short_name}|${st.stop_id}`;
                if (!scheduledByRouteStop[routeKey]) {
                  scheduledByRouteStop[routeKey] = [];
                }
                scheduledByRouteStop[routeKey].push({
                  time: st.departure_time || st.arrival_time,
                  tripId: st.trip_id,
                  routeId: route.route_id
                });
                break; // Only match first route
              }
            }
          }
        } catch (error) {
          console.warn(`Error processing stop_time at index ${index}:`, error.message);
        }
      });
    }

    console.log('GTFS data loaded successfully');
    console.log(`Scheduled times loaded: ${Object.keys(scheduledByTripStop).length}`);
    console.log(`Route-based schedules loaded: ${Object.keys(scheduledByRouteStop).length}`);
    
    // Debug: Show sample route data
    console.log('Sample routes:', routes.slice(0, 5).map(r => ({ id: r.route_id, short: r.route_short_name, long: r.route_long_name })));
    console.log('Sample route-based schedule keys:', Object.keys(scheduledByRouteStop).slice(0, 10));
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

// Remove duplicate code - helper maps are built inside initializeGTFS()

// Map for scheduled times: (trip_id|stop_id) -> departure_time string
const scheduledByTripStop = {};

// Route-based fallback lookup: (route_id|stop_id) -> [{ time, tripId }]
const scheduledByRouteStop = {};

// route name map  
const routeNameById = {};

// helper: fetch and decode GTFS-RT feed (with naive caching)
async function fetchGtfsRt(url, cacheObj, ttlSeconds = 180) { // Cache for 3 minutes (180 seconds)
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

// Add root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'GTFS Transit API', 
    version: '1.0.0',
    endpoints: ['/health', '/station/:stationId', '/refresh']
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

        // predicted times (from feed) and delays
        const arrivalObj = stu.arrival || null;
        const departureObj = stu.departure || null;

        let predictedTs = null;
        let predictedType = null;
        let delaySeconds = null;
        
        if (arrivalObj && arrivalObj.time) {
          // Handle Long objects from protobuf
          const timeValue = arrivalObj.time.low !== undefined ? arrivalObj.time.low : Number(arrivalObj.time);
          predictedTs = timeValue * 1000;
          predictedType = 'arrival';
          delaySeconds = arrivalObj.delay !== undefined ? arrivalObj.delay : null;
        } else if (departureObj && departureObj.time) {
          // Handle Long objects from protobuf
          const timeValue = departureObj.time.low !== undefined ? departureObj.time.low : Number(departureObj.time);
          predictedTs = timeValue * 1000;
          predictedType = 'departure';
          delaySeconds = departureObj.delay !== undefined ? departureObj.delay : null;
        }

        // scheduled time (from static stop_times if available)
        let scheduled = scheduledByTripStop[`${tripId}|${stopId}`] || null;
        
        // Fallback: try route-based matching if exact trip match fails
        if (!scheduled && routeId) {
          // Extract route short name from routeId (e.g., "340-4158" -> "340")
          const routeShortName = routeId.split('-')[0];
          const routeSchedules = scheduledByRouteStop[`${routeShortName}|${stopId}`];
          

          
          if (routeSchedules && routeSchedules.length > 0) {
            // Find the closest scheduled time to the predicted time
            if (predictedTs) {
              const predictedTime = new Date(predictedTs);
              const predictedHour = predictedTime.getHours();
              const predictedMinute = predictedTime.getMinutes();
              
              let bestMatch = null;
              let smallestDiff = Infinity;
              
              for (const schedule of routeSchedules) {
                const [h, m] = schedule.time.split(':').map(Number);
                const scheduleDiff = Math.abs((h * 60 + m) - (predictedHour * 60 + predictedMinute));
                if (scheduleDiff < smallestDiff) {
                  smallestDiff = scheduleDiff;
                  bestMatch = schedule;
                }
              }
              
              // Only use if within 30 minutes difference
              if (bestMatch && smallestDiff <= 30) {
                scheduled = bestMatch.time;
              }
            } else {
              // No predicted time, use first available schedule
              scheduled = routeSchedules[0].time;
            }
          }
        }
        
        // Final fallback: create estimated scheduled time from predicted time (in Brisbane timezone)
        if (!scheduled && predictedTs) {
          const predictedTime = new Date(predictedTs);
          // Convert to Brisbane time for the scheduled time display
          const brisbaneTime = new Date(predictedTime.toLocaleString('en-US', {timeZone: 'Australia/Brisbane'}));
          const hours = String(brisbaneTime.getHours()).padStart(2, '0');
          const minutes = String(brisbaneTime.getMinutes()).padStart(2, '0');
          scheduled = `${hours}:${minutes}:00`;
        }

        // compute status using the delay from GTFS-RT feed
        let status = 'Scheduled';
        if (delaySeconds !== null && delaySeconds !== undefined) {
          // delaySeconds is provided directly by GTFS-RT feed
          if (delaySeconds > 60) {
            status = `Delayed +${Math.round(delaySeconds/60)}m`;
          } else if (delaySeconds < -60) {
            status = `Early ${Math.round(-delaySeconds/60)}m`;
          } else {
            status = 'On time';
          }
        }

        // Only include future departures (within next 2 hours, not more than 5 minutes in the past)
        const now = Date.now();
        const maxFutureMs = 2 * 60 * 60 * 1000; // 2 hours
        const maxPastMs = 5 * 60 * 1000; // 5 minutes
        
        if (predictedTs && (predictedTs < now - maxPastMs || predictedTs > now + maxFutureMs)) {
          continue; // Skip this departure - too far in past or future
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
          predictedLocal: predictedTs ? new Date(predictedTs).toLocaleString('en-AU', {timeZone: 'Australia/Brisbane'}) : null,
          predictedEpochMs: predictedTs || null,
          type: predictedType || 'unknown',
          status,
          delaySeconds: delaySeconds // Add delay info for debugging
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

// Lookup stop names by ID
app.get('/lookup/:stopId', (req, res) => {
  try {
    const stopId = req.params.stopId;
    const stopName = stopNameById[stopId];
    res.json({ stopId, stopName: stopName || 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Debug endpoint to analyze station stop matching
app.get('/debug/:stationId', async (req, res) => {
  try {
    const stationId = req.params.stationId;
    
    // Get child stops for this station (same logic as main endpoint)
    const childStops = new Set();
    if (parentStationMap[stationId]) {
      parentStationMap[stationId].forEach(sid => childStops.add(sid));
    }
    childStops.add(stationId); // include the id itself
    
    // Get all stop IDs from current GTFS-RT feed
    const tripEntities = await fetchGtfsRt(TRIPUPDATES_URL, tripUpdatesCache);
    const gtfsRtStopIds = new Set();
    
    for (const entity of tripEntities) {
      if (!entity.tripUpdate) continue;
      const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || entity.tripUpdate.stop_time_update || [];
      
      for (const stu of stopTimeUpdates) {
        const stopId = stu.stopId || stu.stop_id || null;
        if (stopId) gtfsRtStopIds.add(stopId);
      }
    }
    
    // Find intersection
    const matchingStops = [...childStops].filter(stopId => gtfsRtStopIds.has(stopId));
    
    res.json({
      stationId,
      childStops: [...childStops],
      childStopsWithNames: [...childStops].map(id => ({ id, name: stopNameById[id] || 'Unknown' })),
      gtfsRtStopCount: gtfsRtStopIds.size,
      gtfsRtStopSample: [...gtfsRtStopIds].slice(0, 20),
      matchingStops,
      hasMatches: matchingStops.length > 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`GTFS-RT parser listening on port ${PORT}`);
  console.log(`TripUpdates source: ${TRIPUPDATES_URL}`);
});
