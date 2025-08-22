const http = require('http');

// Make a request to the API and show the response
const req = http.get('http://localhost:3000/station/1153?count=1', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('API Response:');
      console.log('Status Code:', res.statusCode);
      console.log('Results count:', parsed.results.length);
      if (parsed.results.length > 0) {
        const first = parsed.results[0];
        console.log('First result:');
        console.log('  Trip ID:', first.tripId);
        console.log('  Scheduled:', first.scheduled);
        console.log('  Predicted:', first.predicted);
        console.log('  Status:', first.status);
        console.log('  Delay Seconds:', first.delaySeconds);
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.setTimeout(5000, () => {
  console.error('Request timed out');
  req.destroy();
});