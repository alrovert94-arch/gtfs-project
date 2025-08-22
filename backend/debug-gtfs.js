const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const https = require('https');

async function debugGTFS() {
  return new Promise((resolve, reject) => {
    https.get('https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates', (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          let feed;
          if (GtfsRealtimeBindings.FeedMessage) {
            feed = GtfsRealtimeBindings.FeedMessage.decode(buffer);
          } else if (GtfsRealtimeBindings.transit_realtime) {
            feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
          }
          
          // Find entities with stop 1153
          const entities = feed.entity.filter(e => 
            e.tripUpdate && e.tripUpdate.stopTimeUpdate && 
            e.tripUpdate.stopTimeUpdate.some(stu => stu.stopId === '1153')
          );
          
          console.log(`Found ${entities.length} entities with stop 1153`);
          
          if (entities.length > 0) {
            const entity = entities[0];
            const stopUpdate = entity.tripUpdate.stopTimeUpdate.find(stu => stu.stopId === '1153');
            
            console.log('\n=== ENTITY DEBUG ===');
            console.log('Trip ID:', entity.tripUpdate.trip.tripId);
            console.log('Route ID:', entity.tripUpdate.trip.routeId);
            console.log('\n=== STOP UPDATE ===');
            console.log('Stop ID:', stopUpdate.stopId);
            console.log('Stop Sequence:', stopUpdate.stopSequence);
            
            if (stopUpdate.arrival) {
              console.log('\n=== ARRIVAL ===');
              console.log('Time (epoch):', stopUpdate.arrival.time);
              console.log('Time (date):', new Date(stopUpdate.arrival.time * 1000).toISOString());
              console.log('Time (Brisbane):', new Date(stopUpdate.arrival.time * 1000).toLocaleString('en-AU', {timeZone: 'Australia/Brisbane'}));
              console.log('Delay:', stopUpdate.arrival.delay);
              console.log('Delay type:', typeof stopUpdate.arrival.delay);
              console.log('Delay constructor:', stopUpdate.arrival.delay.constructor.name);
              console.log('Uncertainty:', stopUpdate.arrival.uncertainty);
              console.log('All arrival keys:', Object.keys(stopUpdate.arrival));
            }
            
            if (stopUpdate.departure) {
              console.log('\n=== DEPARTURE ===');
              console.log('Time (epoch):', stopUpdate.departure.time);
              console.log('Time (date):', new Date(stopUpdate.departure.time * 1000).toISOString());
              console.log('Time (Brisbane):', new Date(stopUpdate.departure.time * 1000).toLocaleString('en-AU', {timeZone: 'Australia/Brisbane'}));
              console.log('Delay:', stopUpdate.departure.delay);
              console.log('Uncertainty:', stopUpdate.departure.uncertainty);
              console.log('All departure keys:', Object.keys(stopUpdate.departure));
            }
            
            console.log('\n=== SCHEDULE RELATIONSHIP ===');
            console.log('Schedule Relationship:', stopUpdate.scheduleRelationship);
            
            resolve();
          } else {
            console.log('No entities found with stop 1153');
            resolve();
          }
        } catch (e) {
          console.error('Error:', e.message);
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

debugGTFS().catch(console.error);