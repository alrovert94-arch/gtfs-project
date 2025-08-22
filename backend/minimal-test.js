// Minimal test to check if the issue is in the delay extraction
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const https = require('https');

async function testDelayExtraction() {
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
          
          // Find first entity with stop 1153
          for (const entity of feed.entity) {
            if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;
            
            for (const stu of entity.tripUpdate.stopTimeUpdate) {
              if (stu.stopId !== '1153') continue;
              
              console.log('=== TESTING DELAY EXTRACTION ===');
              console.log('Trip ID:', entity.tripUpdate.trip.tripId);
              console.log('Stop ID:', stu.stopId);
              
              // Test the same logic as in the main code
              const arrivalObj = stu.arrival || null;
              const departureObj = stu.departure || null;
              
              let delaySeconds = null;
              let predictedTs = null;
              
              if (arrivalObj && arrivalObj.time) {
                const timeValue = arrivalObj.time.low !== undefined ? arrivalObj.time.low : Number(arrivalObj.time);
                predictedTs = timeValue * 1000;
                delaySeconds = arrivalObj.delay !== undefined ? arrivalObj.delay : null;
                
                console.log('ARRIVAL:');
                console.log('  Raw time:', arrivalObj.time);
                console.log('  Extracted time value:', timeValue);
                console.log('  Predicted timestamp:', predictedTs);
                console.log('  Predicted date:', new Date(predictedTs).toISOString());
                console.log('  Raw delay:', arrivalObj.delay);
                console.log('  Extracted delaySeconds:', delaySeconds);
                console.log('  Delay type:', typeof delaySeconds);
              }
              
              if (departureObj && departureObj.time) {
                const timeValue = departureObj.time.low !== undefined ? departureObj.time.low : Number(departureObj.time);
                predictedTs = timeValue * 1000;
                delaySeconds = departureObj.delay !== undefined ? departureObj.delay : null;
                
                console.log('DEPARTURE:');
                console.log('  Raw time:', departureObj.time);
                console.log('  Extracted time value:', timeValue);
                console.log('  Predicted timestamp:', predictedTs);
                console.log('  Predicted date:', new Date(predictedTs).toISOString());
                console.log('  Raw delay:', departureObj.delay);
                console.log('  Extracted delaySeconds:', delaySeconds);
                console.log('  Delay type:', typeof delaySeconds);
              }
              
              // Test status calculation
              let status = 'Scheduled';
              console.log('STATUS CALCULATION:');
              console.log('  delaySeconds:', delaySeconds);
              console.log('  delaySeconds !== null:', delaySeconds !== null);
              console.log('  delaySeconds !== undefined:', delaySeconds !== undefined);
              
              if (delaySeconds !== null && delaySeconds !== undefined) {
                console.log('  Using GTFS-RT delay');
                if (delaySeconds > 60) {
                  status = `Delayed +${Math.round(delaySeconds/60)}m`;
                } else if (delaySeconds < -60) {
                  status = `Early ${Math.round(-delaySeconds/60)}m`;
                } else {
                  status = 'On time';
                }
              } else {
                console.log('  No delay available, keeping status as Scheduled');
              }
              
              console.log('  Final status:', status);
              console.log('=== END TEST ===');
              
              resolve();
              return;
            }
          }
          
          console.log('No entities found with stop 1153');
          resolve();
        } catch (e) {
          console.error('Error:', e.message);
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

testDelayExtraction().catch(console.error);