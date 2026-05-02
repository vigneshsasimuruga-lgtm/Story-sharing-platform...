# StoryArc - Story Sharing Platform

A full-stack community platform for writing and sharing stories.

## Tech Stack
- **Frontend**: React, Tailwind CSS, Framer Motion, Lucide Icons, Axios.
- **Backend**: Node.js, Express, better-sqlite3 (SQL compatibility), JWT, Bcrypt.
- **Database**: SQLite (SQL)

## Features
- **User Module**: JWT Authentication, Profile management, Bio updates.
- **Stories**: Full CRUD, Categories, Pagination, Search.
- **Social**: 5-star Rating system, Comments.
- **Admin**: Dashboard with platform stats and content/user management.

## Setup & Run
1. The app is pre-configured to run with `npm run dev`.
2. The server handles both the API and Vite frontend serving.
3. The first user to register automatically becomes an **Admin**.
4. Categories (Love, Horror, etc.) are seeded on first launch.

## Folder Structure
- `/server.ts` - Main Express server & Database logic.
- `/src/App.tsx` - Routing and Auth logic.
- `/src/pages/` - UI pages (Home, Auth, Story, Admin, Profile).
- `/src/context/` - Auth state management.
- `/src/lib/` - API/Axios configuration.
- `/schema.sql` - Database table definitions.
