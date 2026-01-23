# Roaming & Interconnect Dashboard Backend

## Overview
This is the backend for the Roaming & Interconnect Dashboard project. It is built using Node.js, Express, and TypeScript, providing a RESTful API for the frontend application.

## Prerequisites
- Node.js (version 14 or higher)
- MySQL database

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd roaming-interconnect-dashboard/backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure the database connection in `.env` (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT).
4. Create the database schema from the single source file:
   ```
   npx ts-node setup-database.ts
   ```

## Running the Application

To start the backend server, run:
```
npm start
```

The server will be running on `http://localhost:3000` by default (or `PORT` from `.env`).

## API Endpoints

- **GET /api/dashboard**: Fetches data for the dashboard.
- Additional endpoints can be defined in the `src/routes/index.ts` file.

## Development

For development purposes, you can run the server in watch mode:
```
npm run dev
```

This will automatically restart the server on file changes.

## Testing

To run tests, use:
```
npm test
```

## License

This project is licensed under the MIT License. See the LICENSE file for more details.
