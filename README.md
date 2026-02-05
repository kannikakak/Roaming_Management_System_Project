# Roaming & Interconnect Dashboard

This project is a Roaming & Interconnect Dashboard built with a Node.js and Express backend, and a React frontend. It provides a comprehensive interface for managing and visualizing roaming and interconnect data.

## Project Structure

```
roaming-interconnect-dashboard
├── backend                # Backend application
│   ├── src                # Source files for the backend
│   ├── package.json       # Backend dependencies and scripts
│   ├── tsconfig.json      # TypeScript configuration for the backend
│   └── README.md          # Backend documentation
├── frontend               # Frontend application
│   ├── src                # Source files for the frontend
│   ├── public             # Public assets for the frontend
│   ├── package.json       # Frontend dependencies and scripts
│   ├── tsconfig.json      # TypeScript configuration for the frontend
│   └── README.md          # Frontend documentation
└── README.md              # Root documentation
```

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- MySQL database

### Backend Setup

1. Navigate to the `backend` directory:
   ```
   cd backend
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Configure your MySQL database connection in `src/app.ts`.

4. Start the backend server:
   ```
   npm start
   ```

### Frontend Setup

1. Navigate to the `frontend` directory:
   ```
   cd frontend
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Start the frontend application:
   ```
   npm start
   ```

## Usage

Once both the backend and frontend are running, you can access the dashboard through your web browser at `http://localhost:3000`.

### Operations Center & Data Quality

The `/operations` route exposes the Roaming Control Tower and surfaces an Upload Intelligence card so teams can compare the latest upload vs. the previous one. The new **Data Quality** page (accessible from the sidebar) scores each file from 0–100 based on completeness, missing partners/dates, and revenue issues and highlights problem areas with badges and tooltips.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for any improvements or bug fixes.

## License

This project is licensed under the MIT License.
