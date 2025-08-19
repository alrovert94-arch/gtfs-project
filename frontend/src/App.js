import React, { useState, useRef, useEffect, useCallback } from 'react';
import Timetable from './Timetable';
import './App.css';

function App() {
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [timetableStats, setTimetableStats] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const timetableRef = useRef();

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (event.key === 'r' || event.key === 'R') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          handleRefresh();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRefresh = () => {
    if (timetableRef.current) {
      setRefreshing(true);
      timetableRef.current.refresh();
      // Reset refreshing state after a short delay
      setTimeout(() => setRefreshing(false), 1000);
    }
  };

  const handleStatsUpdate = useCallback((stats) => {
    setTimetableStats(stats);
  }, []);

  const formatLastUpdated = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Australia/Brisbane'
    });
  };

  const formatCurrentTime = (date) => {
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Australia/Brisbane'
    });
  };

  const formatCurrentDate = (date) => {
    return date.toLocaleDateString('en-AU', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Australia/Brisbane'
    });
  };

  return (
    <div className="App">
      <header className="header">
        <div className="header-top">
          <div className="station-info">
            <div className="station-title">
              <div className="station-icon">🚌</div>
              King George Square
            </div>
            <div className="station-subtitle">Brisbane City Transit Hub</div>
          </div>
          <div className="time-display">
            <div className="current-time">{formatCurrentTime(currentTime)}</div>
            <div className="current-date">{formatCurrentDate(currentTime)}</div>
          </div>
        </div>
        <div className="live-indicator">
          <div className={`live-dot ${isOnline ? 'online' : 'offline'}`}></div>
          {isOnline ? 'Live Departures' : 'Offline Mode'}
        </div>
        <div className="header-controls">
          <div className="last-updated">
            {lastUpdated && (
              <>
                <span>🕒</span>
                <span>Updated: {formatLastUpdated(lastUpdated)}</span>
              </>
            )}
          </div>
          {/* <button 
            className={`refresh-button ${refreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data (Ctrl+R)"
          >
            <span className="refresh-icon">🔄</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
            <span className="keyboard-shortcut">⌘R</span>
          </button> */}
        </div>
      </header>
      
      {/* Service Alerts */}
      {!isOnline && (
        <div className="service-alerts alert-severe">
          <div className="alert-header">
            <span>📡</span>
            <span>Connection Lost</span>
          </div>
          <div className="alert-content">
            You're currently offline. Displaying cached data. Connect to internet for live updates.
          </div>
        </div>
      )}
      
      <div className="service-alerts">
        <div className="alert-header">
          <span>⚠️</span>
          <span>Service Notice</span>
        </div>
        <div className="alert-content">
          Real-time data may be delayed during peak hours. Check official Translink app for service disruptions.
        </div>
      </div>

      {/* Quick Stats */}
      {timetableStats && (
        <div className="quick-stats">
          <div className="stat-card">
            <div className="stat-number">{timetableStats.total}</div>
            <div className="stat-label">Services</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{timetableStats.onTime}</div>
            <div className="stat-label">On Time</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{timetableStats.delayed}</div>
            <div className="stat-label">Delayed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{timetableStats.nextDeparture}</div>
            <div className="stat-label">Next in</div>
          </div>
        </div>
      )}

      <Timetable 
        ref={timetableRef}
        stationId="place_kgbs" 
        onUpdate={setLastUpdated}
        onStatsUpdate={handleStatsUpdate}
      />
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-info">
            <span>🚌 Real-time data from Translink Brisbane</span>
            <span>•</span>
            <span>Updates every 5 minutes</span>
          </div>
          <div className="footer-note">
            Times shown in Brisbane timezone (AEST/AEDT)
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
