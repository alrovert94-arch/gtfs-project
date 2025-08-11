# GTFS Real-Time Transit Monitor - Archive Information

## Archive Details
- **Archive Date**: 2025-01-27
- **Git Commit**: 337b896
- **Version Tag**: v1.0.0-archive
- **Repository**: https://github.com/alrovert94-arch/gtfs-realtime-transit-monitor.git

## Project Summary
This is a complete, production-ready real-time public transit monitoring system built for Brisbane's Translink network. The system combines static GTFS data with live GTFS-Realtime feeds to provide accurate, real-time transit information.

## Architecture
- **Backend**: Node.js/Express API (Port 3000)
- **Frontend**: React 19 SPA (Port 3001)
- **Automation**: n8n workflow engine (Port 5678)
- **Data**: Complete Brisbane Translink GTFS dataset

## Key Features
- Real-time GTFS-RT feed processing
- Sophisticated delay calculation algorithms
- Station hierarchy support (parent/child stops)
- In-memory caching with TTL
- Docker containerization
- Automated data refresh workflows
- Live timetable display with status indicators

## File Structure
```
gtfs-project/
├── backend/                 # Node.js API server
│   ├── index.js            # Main server file
│   ├── package.json        # Dependencies
│   ├── Dockerfile          # Container config
│   └── stations.json       # Station configuration
├── frontend/               # React application
│   ├── src/
│   │   ├── App.js         # Main app component
│   │   └── Timetable.js   # Live timetable component
│   └── package.json       # Frontend dependencies
├── static-gtfs/           # Brisbane Translink GTFS data
│   ├── stops.txt          # 12,958+ stops
│   ├── routes.txt         # Route definitions
│   ├── stop_times.txt     # Scheduled times
│   └── [other GTFS files]
├── docker-compose.yml     # Multi-service orchestration
└── README.md             # Comprehensive documentation
```

## Data Sources
- **Static GTFS**: Brisbane Translink complete dataset
- **Real-time GTFS-RT**: 
  - TripUpdates: https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates
  - VehiclePositions: https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions

## Technical Specifications
- **Node.js**: v20 (Docker)
- **React**: v19.1.1
- **Express**: v5.1.0
- **GTFS-RT Bindings**: v1.1.1
- **n8n**: v1.100.1

## Deployment
```bash
# Start all services
docker-compose up --build

# Start frontend separately
cd frontend && npm install && npm start
```

## API Endpoints
- `GET /health` - Health check
- `GET /station/:stationId` - Live timetable
- `GET /refresh` - Manual data refresh
- `GET /stations-list` - Available stations
- `GET /raw` - Raw feed data

## Archive Contents
This archive contains:
- Complete source code
- Full Git history
- Static GTFS dataset (6M+ records)
- Docker configuration
- Documentation
- All dependencies and configurations

## Restoration Instructions
1. Clone from GitHub: `git clone https://github.com/alrovert94-arch/gtfs-realtime-transit-monitor.git`
2. Or use the bundle: `git clone gtfs-project-archive.bundle gtfs-project`
3. Follow README.md for setup and deployment

## Contact
Project archived by: alrovert94-arch
Archive location: GitHub repository and local bundle file