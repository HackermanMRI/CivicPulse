# Running CivicPulse (Windows + Docker Desktop)

Everything runs in Docker. You type the commands below in **PowerShell**, inside the project folder.

## 1. Get the code

First time:
```powershell
git clone https://github.com/<your-account>/<your-repo>.git civicpulse
cd civicpulse
git checkout feat/scoring-engine
```
Already cloned:
```powershell
cd civicpulse
git fetch origin
git checkout feat/scoring-engine
git pull origin feat/scoring-engine
```

## 2. What you need installed

| Tool | Why | Check |
|---|---|---|
| Docker Desktop (WSL2 backend) | runs every service | `docker compose version` |
| Git | get the code | `git --version` |
| Python 3 (any recent) | only to make random secrets | `python --version` |
| mkcert | local HTTPS certificate (camera and precise GPS need HTTPS) | `mkcert -version` |

Install mkcert with `winget install FiloSottile.mkcert` (or `choco install mkcert`).
You do **not** need Node or Python packages on Windows: the images install them.

## 3. Environment file

```powershell
copy .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```
Run the second line 4 times and paste the values into `.env` for `OWNER_DB_PASSWORD`, `APP_DB_PASSWORD`, `SECRET_KEY` and
`IP_HASH_SALT`. Also set:
- `DEMO_PASSWORD` – password of the three DEMO accounts (8+ characters, not only digits);
- `FRONTEND_ORIGIN` – `https://localhost,https://<your laptop LAN IP>` (find the IP with `ipconfig`, "IPv4 Address").

Every variable is explained inside `.env.example`. `.env` is gitignored; never commit it.

## 4. HTTPS certificate (once per laptop)

```powershell
mkcert -install
mkdir docker\certs
mkcert -cert-file docker\certs\cert.pem -key-file docker\certs\key.pem localhost 127.0.0.1 <your LAN IP>
```
For phones: copy the file from `mkcert -CAROOT` (`rootCA.pem`) to each phone and install it as a CA certificate
(Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate).

## 5. Start everything

```powershell
docker compose up -d --build
docker compose ps
```
The first build downloads PyTorch for the worker and takes a while. All six services should be `running`
(`api` shows `healthy`). The API applies the database migration and loads the 7 categories on start.

Check:
```powershell
curl.exe http://127.0.0.1:8000/api/health
```
Expected: `"database": true`, `"migration": "0001"`, `"tables": 36`, `"categories": 7`.

Open **https://localhost** on the laptop, or **https://<LAN IP>** on a phone on the same Wi-Fi.

| Service | What it does |
|---|---|
| nginx | the only public entry (ports 443 and 80): HTTPS, the React app, `/api` proxy, SSE, security headers |
| api | FastAPI: every endpoint, validation, auth, cheap scoring |
| worker | RQ worker: ML scoring, full scoring runs, reputation, batch jobs (CPU by default) |
| scheduler | queues the hourly and daily jobs (auto-hide, alerts, hotspots, collusion scan) |
| db | PostgreSQL 16 + PostGIS 3.4 |
| redis | job queue, rate limits, live notifications |

## 6. Load the DEMO data (for the pre-defence)

```powershell
docker compose exec api python -m app.cli seed-demo
```
Takes about 1–3 minutes. Log in with `01700000001`, `01700000002` or `01700000003` and your `DEMO_PASSWORD`.
Remove it again (real data is kept): `docker compose exec api python -m app.cli reset-demo --yes`.
Details: [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

## 7. Create an admin

```powershell
docker compose exec api python -m app.cli create-admin --phone 01XXXXXXXXX --name "Member A"
```
It asks for the password twice. Admin login always asks for a code; in `DEV_MODE` the code is shown on screen.

## 8. Run the tests

```powershell
docker compose exec db createdb -U civicpulse_owner civicpulse_test
docker compose exec -e TEST_DATABASE_URL=postgresql+psycopg2://civicpulse_owner:<OWNER_DB_PASSWORD>@db:5432/civicpulse_test api python -m pytest -q
```
Expected: 86 passed (54 scoring + 32 API/security). The test database is wiped on every run; never point it at `civicpulse`.
Without `TEST_DATABASE_URL` only the 54 scoring tests run.

## 9. Optional: GPU worker

In `.env`: `TORCH_INDEX=https://download.pytorch.org/whl/cu124` and `DEVICE=cuda`, then
```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build worker
```
Without a GPU the worker uses the CPU automatically.

## 10. Frontend development (optional)

Needs Node 22 on Windows. The API must be running (it listens on 127.0.0.1:8000).
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. Camera access works on `localhost` without a certificate. Set `COOKIE_SECURE=false`
in `.env` and restart `api` for this plain-http mode, and set it back to `true` afterwards.

## Useful commands

| Task | Command |
|---|---|
| Logs | `docker compose logs -f api worker scheduler` |
| Stop | `docker compose down` |
| Wipe ALL data and start clean | `docker compose down -v` then `docker compose up -d --build` |
| SQL shell | `docker compose exec db psql -U civicpulse_owner -d civicpulse` |
| Re-run a daily job now | `docker compose exec api python -c "from app.worker import jobs; print(jobs.daily_hotspots())"` |

## Troubleshooting

| Problem | Fix |
|---|---|
| `set OWNER_DB_PASSWORD in .env` | You skipped step 3. |
| nginx keeps restarting | `docker\certs\cert.pem` / `key.pem` are missing (step 4). |
| Login works but you are logged out on reload | `FRONTEND_ORIGIN` does not list the address in the browser bar. |
| Phone: camera or location blocked | Open the site with `https://`, and install the mkcert CA on the phone. |
| Reports stay "Checking…" | The worker is not running: `docker compose logs worker`. The scheduler re-queues them every 5 minutes. |
| Changed DB passwords in `.env` and now it fails | Passwords are set when the volume is first created: `docker compose down -v` (deletes data). |
