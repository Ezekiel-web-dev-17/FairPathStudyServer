# FairPath Study Server

[![Node.js](https://img.shields.io/badge/Node.js-v20+-8CC84B?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-v5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-v7-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-v5-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Arcjet](https://img.shields.io/badge/Arcjet-Shielded-4F46E5?style=for-the-badge)](https://arcjet.com/)
[![Jest](https://img.shields.io/badge/Jest-Tested-C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)

A modern, high-performance, secure ed-tech backend API designed to power the **FairPath Study** platform. It enables global students to find matching universities, look up custom scholarships, track admission applications, and save matches. It features JWT authentication, Redis caching, comprehensive security protection via Arcjet, and Prisma integration with PostgreSQL.

---

## Key Features

* **Bulletproof Security (Arcjet Integration)**
  * Automated **WAF shield** rules protecting against common attacks (SQLi, XSS, etc.).
  * Layered **rate-limiting** matching endpoints (100 req/min for general API, 10 req/min strict brute-force protection for Auth).
  * **Bot detection** blocking programmatic, scraper, and tool-based traffic.
* **Secure JWT Authentication**: Robust access control featuring cookie/header tokens, role-based checks (`STUDENT` / `ADMIN`), and encrypted password storage.
* **Redis Caching**: Intelligent caching middleware for speedy database lookups on featured universities and scholarship recommendations.
* **Prisma ORM + PostgreSQL**: Fully typed query builder using Postgres for student profiles, matches, and application pipelines.
* **Test-Driven Environment**: Automated Jest and Supertest ESM-compatible test suite covering all critical endpoint behaviors.
* **Comprehensive Admin Portal**: Built-in endpoints for managing universities and reporting match analytics.

---

## Technology Stack

* **Runtime**: Node.js & TypeScript
* **Framework**: Express (v5)
* **Database & ORM**: PostgreSQL + Prisma Client (v7)
* **Caching & Performance**: Redis (v5 client)
* **Security & Shielding**: Arcjet, Helmet, CORS, and bcryptjs
* **Logging**: Winston & Morgan
* **Testing**: Jest & Supertest

---

## Project Structure

```text
FairPathStudyServer/
├── prisma/                  # Database config, migrations, and seed scripts
│   ├── schema.prisma        # Prisma Database Schema
│   └── seed.ts              # Database seeder logic
├── src/
│   ├── __tests__/           # Jest test suites
│   ├── config/              # App config, database clients, Redis & Arcjet setup
│   ├── controllers/         # Route request handlers
│   ├── middleware/          # JWT auth, caching, rate limiting, and error handling
│   ├── models/              # Schema types and DB helper models
│   ├── routes/              # Express Router API endpoints
│   ├── services/            # Core business logic layer
│   ├── utils/               # Loggers and standard utility helpers
│   ├── app.ts               # App Express middleware assembly
│   └── server.ts            # Entrypoint (Listens on configured PORT)
├── .env.development.local   # Local dev environment configurations
└── .env.test.local          # Local test environment configurations
```

---

## Getting Started

### 1. Prerequisites
Ensure you have the following installed:
* [Node.js](https://nodejs.org/) (v20 or higher)
* [PostgreSQL](https://www.postgresql.org/) (Local or running in Docker)
* [Redis](https://redis.io/)

### 2. Clone and Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Create your local environment files based on the structure. A `.env.development.local` and `.env.test.local` are used to control application state:

```env
PORT=5000
DATABASE_URL="postgresql://<user>:<password>@localhost:<port>/<db_name>?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your_jwt_secret_key"
NODE_ENV="development"
ARCJET_KEY="your_arcjet_live_key"
```

### 4. Database Setup & Seeding
Use Prisma commands to provision and seed the PostgreSQL database:

```bash
# Generate Prisma Client
npm run generate

# Run database migrations
npm run migrate

# Seed the database with mocked universities and scholarships
npm run seed
```

### 5. Running the Application

* **Development (Watch Mode)**:
  ```bash
  npm run dev
  ```
* **Production Build**:
  ```bash
  npm run build
  npm run start
  ```

---

## Testing

The backend is verified using [Jest](https://jestjs.io/) and [Supertest](https://github.com/ladjs/supertest) with ESM modules.

Run the test suite with:
```bash
npm run test
```

---

## Key API Endpoints (`/api/v1`)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| **POST** | `/auth/register` | Register a new student account | None |
| **POST** | `/auth/login` | Login to receive a JWT session | None |
| **GET** | `/users/me` | Fetch active student session profile | Student / Admin |
| **PUT** | `/users/me/profile` | Update profile academic details & targets | Student |
| **GET** | `/universities` | Query matching universities with pagination | None |
| **GET** | `/universities/featured` | Fetch cached/live featured partner universities | None |
| **GET** | `/universities/:slug` | View details of a specific university | None |
| **GET** | `/scholarships` | Fetch scholarships matching category criteria | None |
| **GET** | `/scholarships/recommended`| Recommended scholarships based on profile | Student |
| **GET** | `/dashboard/summary` | Student dashboard statistics & application pipeline | Student |
| **GET** | `/favourites` | Fetch saved universities & scholarships | Student |
| **POST** | `/favourites` | Add match matching ID to saved list | Student |
| **GET** | `/admin/analytics` | Retrieve global platform statistics & analytics | Admin Only |
| **POST** | `/admin/universities` | Add a new university profile | Admin Only |

---

## Security Architecture

### Arcjet Layer
The server enforces advanced middleware shielding on all requests:
1. **Attack Shield (WAF)**: Guards against injection attacks, path traversal, malicious user agents, and raw payloads.
2. **Intelligent Rate Limiter**: Leverages sliding or fixed window strategies to prevent Denial of Service (DoS) and authentication brute forcing.
3. **Bot Scrapers Shield**: Restricts AI scraper scrapers and raw script utilities to safeguard the data pipeline from crawlers.

---

## License
This project is licensed under the [ISC License](LICENSE).
