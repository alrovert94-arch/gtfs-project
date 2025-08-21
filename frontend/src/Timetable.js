import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'Australia/Brisbane'
  });
}

function getCountdownText(predictedTime) {
  if (!predictedTime) return null;
  
  const now = new Date();
  const predicted = new Date(predictedTime);
  const diffMs = predicted.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  
  if (diffMinutes < 0) return 'Departed';
  if (diffMinutes === 0) return 'Due now';
  if (diffMinutes === 1) return '1 min';
  if (diffMinutes < 60) return `${diffMinutes} mins`;
  
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return `${hours}h ${mins}m`;
}

function getCountdownClass(predictedTime) {
  if (!predictedTime) return 'countdown-cell';
  
  const now = new Date();
  const predicted = new Date(predictedTime);
  const diffMs = predicted.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  
  if (diffMinutes < 0) return 'countdown-cell countdown-departed';
  if (diffMinutes === 0) return 'countdown-cell countdown-due-now';
  if (diffMinutes <= 2) return 'countdown-cell countdown-urgent';
  if (diffMinutes <= 5) return 'countdown-cell countdown-soon';
  return 'countdown-cell countdown-normal';
}

function formatScheduledTime(timeStr) {
  if (!timeStr) return '—';
  // timeStr is like "23:27:00", convert to "23:27"
  const [hours, minutes] = timeStr.split(':');
  return `${hours}:${minutes}`;
}

function parseRouteName(routeName) {
  if (!routeName) return { number: '', name: '', type: 'bus' };
  
  // Extract route number (first part before space or dash)
  const match = routeName.match(/^([A-Z0-9]+)\s+(.+)$/);
  if (match) {
    const number = match[1];
    const name = match[2];
    const type = getRouteType(number, name);
    return { number, name, type };
  }
  
  // If no clear pattern, use first word as number
  const parts = routeName.split(' ');
  if (parts.length > 1) {
    const number = parts[0];
    const name = parts.slice(1).join(' ');
    const type = getRouteType(number, name);
    return { number, name, type };
  }
  
  return { number: routeName, name: '', type: 'bus' };
}

function getRouteType(number, name) {
  if (number.startsWith('M')) return 'metro';
  if (name.toLowerCase().includes('express')) return 'express';
  if (name.toLowerCase().includes('citycat') || name.toLowerCase().includes('ferry')) return 'ferry';
  if (name.toLowerCase().includes('train')) return 'train';
  return 'bus';
}

function getRouteIcon(type) {
  switch (type) {
    case 'metro': return '🚇';
    case 'express': return '🚌';
    case 'ferry': return '⛴️';
    case 'train': return '🚆';
    default: return '🚌';
  }
}

function calculateStatus(scheduledTime, predictedTime) {
  if (!scheduledTime || !predictedTime) return 'Scheduled';
  
  try {
    // Parse predicted time (ISO string in UTC) and convert to Brisbane time
    const predictedUTC = new Date(predictedTime);
    
    // Convert to Brisbane timezone using proper timezone handling
    const predictedBrisbane = new Date(predictedUTC.toLocaleString('en-US', {
      timeZone: 'Australia/Brisbane'
    }));
    
    // Parse scheduled time (format: "HH:MM:SS")
    const [schedHour, schedMin, schedSec] = scheduledTime.split(':').map(Number);
    
    // Create scheduled time on the same date as predicted time (Brisbane timezone)
    const scheduledDate = new Date(predictedBrisbane);
    scheduledDate.setHours(schedHour, schedMin, schedSec || 0, 0);
    
    // Handle day boundary crossings - if the difference is huge, adjust the scheduled date
    let timeDiff = predictedBrisbane.getTime() - scheduledDate.getTime();
    
    // If more than 12 hours difference, the scheduled time might be for the previous/next day
    if (timeDiff > 12 * 60 * 60 * 1000) {
      // Predicted is much later than scheduled - scheduled might be previous day
      scheduledDate.setDate(scheduledDate.getDate() + 1);
      timeDiff = predictedBrisbane.getTime() - scheduledDate.getTime();
    } else if (timeDiff < -12 * 60 * 60 * 1000) {
      // Predicted is much earlier than scheduled - scheduled might be next day  
      scheduledDate.setDate(scheduledDate.getDate() - 1);
      timeDiff = predictedBrisbane.getTime() - scheduledDate.getTime();
    }
    
    // Calculate difference in minutes
    const diffMinutes = Math.round(timeDiff / (1000 * 60));
    
    // Debug logging for problematic cases
    if (Math.abs(diffMinutes) > 60) {
      console.log('Status calculation debug:', {
        scheduledTime,
        predictedTime,
        predictedBrisbane: predictedBrisbane.toISOString(),
        scheduledDate: scheduledDate.toISOString(),
        diffMinutes
      });
    }
    
    if (Math.abs(diffMinutes) <= 1) {
      return 'On time';
    } else if (diffMinutes > 1) {
      return `Delayed ${diffMinutes}m`;
    } else {
      return `Early ${Math.abs(diffMinutes)}m`;
    }
  } catch (error) {
    console.warn('Error calculating status:', error, { scheduledTime, predictedTime });
    return 'Scheduled';
  }
}

function getStatusClass(status) {
  if (status === 'On time') return 'status-on-time';
  if (status.startsWith('Delayed')) return 'status-delayed';
  if (status.startsWith('Early')) return 'status-early';
  return 'status-scheduled';
}

function calculateStats(items) {
  if (!items || items.length === 0) {
    return {
      total: 0,
      onTime: 0,
      delayed: 0,
      nextDeparture: '—'
    };
  }

  const total = items.length;
  
  // Calculate status for each item if not already present
  const itemsWithStatus = items.map(item => ({
    ...item,
    calculatedStatus: item.status || calculateStatus(item.scheduled, item.predicted)
  }));
  
  const onTime = itemsWithStatus.filter(item => item.calculatedStatus === 'On time').length;
  const delayed = itemsWithStatus.filter(item => item.calculatedStatus.startsWith('Delayed')).length;
  
  // Find next departure
  const now = new Date();
  const nextItem = itemsWithStatus.find(item => {
    if (!item.predicted) return false;
    const predicted = new Date(item.predicted);
    return predicted > now;
  });
  
  const nextDeparture = nextItem ? getCountdownText(nextItem.predicted) : '—';
  
  return {
    total,
    onTime,
    delayed,
    nextDeparture
  };
}

const Timetable = forwardRef(function Timetable({ stationId = 'place_kgbs', onUpdate, onStatsUpdate }, ref) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  async function load(isManualRefresh = false) {
    try {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      
      const res = await fetch(`${API_BASE}/station/${stationId}?count=20`);
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      const results = j.results || [];
      setItems(results);
      setErr(null);
      const now = new Date();
      setLastUpdated(now);
      if (onUpdate) onUpdate(now);
      
      // Calculate and update stats
      if (onStatsUpdate) {
        const stats = calculateStats(results);
        onStatsUpdate(stats);
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleManualRefresh = useCallback(() => {
    load(true);
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: handleManualRefresh
  }));

  useEffect(() => {
    load();
    const id = setInterval(load, 300000); // Update every 5 minutes (300,000ms = 5 * 60 * 1000)
    return () => clearInterval(id);
  }, [stationId]);

  // Update countdown timers every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Memoize demo data to prevent recreation on every render
  const demoItems = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Create realistic scheduled times around current time
    const scheduledTime1 = `${String(currentHour).padStart(2, '0')}:${String(currentMinute + 2).padStart(2, '0')}:00`;
    const scheduledTime2 = `${String(currentHour).padStart(2, '0')}:${String(currentMinute + 5).padStart(2, '0')}:00`;
    const scheduledTime3 = `${String(currentHour).padStart(2, '0')}:${String(currentMinute + 8).padStart(2, '0')}:00`;
    
    const items = [
      {
        routeName: "M1 Eight Mile Plains - City",
        scheduled: scheduledTime1,
        predicted: new Date(Date.now() + 2 * 60000).toISOString(), // On time
        stopName: "Platform 1"
      },
      {
        routeName: "333 Chermside - Woolloongabba via City",
        scheduled: scheduledTime2,
        predicted: new Date(Date.now() + 7 * 60000).toISOString(), // 2 min delay
        stopName: "Platform 2"
      },
      {
        routeName: "M2 RBWH - UQ Lakes via City",
        scheduled: scheduledTime3,
        predicted: new Date(Date.now() + 6 * 60000).toISOString(), // 2 min early
        stopName: "Platform 1"
      }
    ];
    
    // Calculate status for each item
    return items.map(item => ({
      ...item,
      status: calculateStatus(item.scheduled, item.predicted)
    }));
  }, []);

  // Handle demo data stats update
  useEffect(() => {
    if (!items.length && !loading && onStatsUpdate) {
      const stats = calculateStats(demoItems);
      onStatsUpdate(stats);
    }
  }, [items.length, loading, onStatsUpdate, demoItems]);

  if (err) {
    return (
      <div className="timetable-container">
        <div className="error-container">
          <div className="error-icon">⚠️</div>
          <div>Unable to load timetable data</div>
          <div style={{ fontSize: '0.875rem', marginTop: '8px', opacity: 0.7 }}>
            {err}
          </div>
        </div>
      </div>
    );
  }

  if (loading && !items.length) {
    return (
      <div className="timetable-container">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <div>Loading live departures...</div>
        </div>
      </div>
    );
  }

  if (!items.length) {
    // Use memoized demo data

    return (
      <div className="timetable-container">
        <div style={{ padding: '16px', textAlign: 'center', background: 'rgba(255, 193, 7, 0.1)', borderBottom: '1px solid rgba(255, 193, 7, 0.3)', color: '#856404' }}>
          ⚠️ Demo Mode - No live services currently available
        </div>
        <table className="timetable">
          <thead>
            <tr>
              <th>Route</th>
              <th>Scheduled</th>
              <th>Predicted</th>
              <th>Countdown</th>
              <th>Platform</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {demoItems.map((u, i) => {
              const route = parseRouteName(u.routeName || u.routeId);
              // Use API status if available and reasonable, otherwise calculate
              const apiStatus = u.status;
              const calculatedStatus = (apiStatus && !apiStatus.includes('+1442m')) ? apiStatus : calculateStatus(u.scheduled, u.predicted);
              return (
                <tr key={i} style={{ opacity: 0.7 }}>
                  <td className="route-cell">
                    <div className="route-info">
                      <span className="route-icon">{getRouteIcon(route.type)}</span>
                      <div className="route-details">
                        <span className="route-number" data-type={route.type}>{route.number}</span>
                        <span className="route-name">{route.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="time-cell">
                    {formatScheduledTime(u.scheduled)}
                  </td>
                  <td className="time-cell predicted-time">
                    {formatTime(u.predicted)}
                  </td>
                  <td className={getCountdownClass(u.predicted)}>
                    {getCountdownText(u.predicted)}
                  </td>
                  <td className="platform-cell">
                    {u.stopName || u.stopId}
                  </td>
                  <td className="status-cell">
                    <span className={getStatusClass(calculatedStatus)}>
                      {calculatedStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="timetable-container">
      <table className="timetable">
        <thead>
          <tr>
            <th>Route</th>
            <th>Scheduled</th>
            <th>Predicted</th>
            <th>Countdown</th>
            <th>Platform</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u, i) => {
            const route = parseRouteName(u.routeName || u.routeId);
            // Use API status if available and reasonable, otherwise calculate
            const apiStatus = u.status;
            const calculatedStatus = (apiStatus && !apiStatus.includes('+1442m')) ? apiStatus : calculateStatus(u.scheduled, u.predicted);
            return (
              <tr key={i}>
                <td className="route-cell">
                  <div className="route-info">
                    <span className="route-icon">{getRouteIcon(route.type)}</span>
                    <div className="route-details">
                      <span className="route-number" data-type={route.type}>{route.number}</span>
                      <span className="route-name">{route.name}</span>
                    </div>
                  </div>
                </td>
                <td className="time-cell">
                  {formatScheduledTime(u.scheduled)}
                </td>
                <td className="time-cell predicted-time">
                  {formatTime(u.predicted)}
                </td>
                <td className={getCountdownClass(u.predicted)}>
                  {getCountdownText(u.predicted)}
                </td>
                <td className="platform-cell">
                  {u.stopName || u.stopId}
                </td>
                <td className="status-cell">
                  <span className={getStatusClass(calculatedStatus)}>
                    {calculatedStatus}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

export default Timetable;
