import React, { useEffect, useState } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Timetable({ stationId = 'place_kgbs' }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/station/${stationId}?count=20`);
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      setItems(j.results || []);
      setErr(null);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [stationId]);

  if (err) return <div style={{ color: 'red' }}>Error: {err}</div>;
  if (!items.length) return <div>Loading or no upcoming services</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Route</th>
          <th style={{ textAlign: 'left' }}>Destination</th>
          <th>Scheduled</th>
          <th>Predicted</th>
          <th>Stop / Platform</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((u, i) => (
          <tr key={i} style={{ borderTop: '1px solid #eee' }}>
            <td>{u.routeName || u.routeId}</td>
            <td>{u.headsign || '—'}</td>
            <td style={{ textAlign: 'center' }}>{u.scheduled || '—'}</td>
            <td style={{ textAlign: 'center' }}>{formatTime(u.predicted)}</td>
            <td style={{ textAlign: 'center' }}>{u.stopName || u.stopId}</td>
            <td style={{ textAlign: 'center', color: u.status.startsWith('Delayed') ? 'crimson' : 'inherit' }}>{u.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
