# GTFS Real-Time Transit Monitor

This is a sophisticated, multi-service data processing and visualization pipeline designed for real-time public transit monitoring. It uses Docker Compose to orchestrate a workflow automation engine (n8n), a data processing backend (Node.js), and a presentation layer (React).

## Project Architecture

The project consists of three main components orchestrated by `docker-compose.yml`:

1.  **`n8n` (Automation Layer)**: A container running [n8n.io](http://n8n.io/), a powerful workflow automation tool. It acts as the project's scheduler, likely configured to periodically trigger the backend's data refresh process.
2.  **`parser` (Backend API)**: A Node.js/Express application that serves as the core data processing engine. It fetches live GTFS-Realtime data, combines it with static GTFS data (from the `static-gtfs` directory), calculates delays, and exposes the results via a REST API.
3.  **`frontend` (Presentation Layer)**: A React single-page application that provides a user-friendly interface for viewing the live transit data served by the backend.

### Data Workflow

1.  **Orchestration**: A workflow in the `n8n` service runs on a schedule (e.g., every minute).
2.  **Trigger**: The n8n workflow sends an HTTP request to the `parser` service's `/refresh` endpoint.
3.  **Processing**: The `parser` service fetches the latest live data, combines it with its static GTFS data, and saves a JSON snapshot to the shared `data/` volume.
4.  **Consumption**: The user opens the React **frontend** in their browser.
5.  **Display**: The frontend calls the `parser` service's `/station/:stationId` endpoint. The backend returns the latest processed data, which is then displayed in the timetable. The frontend continues to poll this endpoint for live updates.

## Prerequisites

Before you begin, ensure you have the following installed:
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) (for running the frontend in development mode)

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd gtfs-project
    ```

2.  **Provide Static GTFS Data:**
    The backend requires static GTFS data files. The project is already configured to use the `static-gtfs` directory. Ensure it contains the necessary files from your transit authority, including:
    - `agency.txt`
    - `calendar.txt`
    - `routes.txt`
    - `stops.txt`
    - `stop_times.txt`
    - `trips.txt`

## Running the Application

This project is designed to be run with Docker Compose, but the frontend can also be run locally for development.

### Recommended Method: Docker Compose

This is the simplest way to run the backend and the n8n automation engine.

1.  **Start the services:**
    ```bash
    docker-compose up --build
    ```
    This command will:
    - Build the Docker image for the `parser` backend.
    - Pull the `n8n` Docker image.
    - Start both containers.

2.  **Run the Frontend (in a separate terminal):**
    ```bash
    cd frontend
    npm install
    npm start
    ```

### Accessing the Services

Once running, the services will be available at the following locations:

-   **Frontend UI**: `http://localhost:3001` (or another port if 3001 is in use)
-   **Backend API**: `http://localhost:3000`
-   **n8n Web Interface**: `http://localhost:5678`
    -   **User**: `admin`
    -   **Password**: `changeme123` (as configured in `docker-compose.yml`)

## Backend API Endpoints

-   `GET /health`: Health check for the server.
-   `GET /station/:stationId`: Returns a live timetable for the specified station ID (e.g., `/station/place_kgbs`).
-   `GET /stations-list`: Returns a list of all available parent stations, which can be used to build a station selector.
-   `GET /refresh`: Manually triggers a refresh of the GTFS-RT data and generates static JSON snapshots in the `data/` directory. This is the endpoint that the n8n workflow should call.
-   `GET /raw`: Serves the last generated raw `tripupdates.json` snapshot.# gtfs-realtime-transit-monitor
