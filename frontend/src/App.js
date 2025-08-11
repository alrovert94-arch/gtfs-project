import React from 'react';
import Timetable from './Timetable';
import './App.css';

function App() {
  return (
    <div className="App" style={{ padding: 20 }}>
      <h1>King George Square (place_kgbs) — Live Timetable</h1>
      <Timetable stationId="place_kgbs" />
    </div>
  );
}

export default App;
