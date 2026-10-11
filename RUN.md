# Running CivicPulse on your laptop (Windows + Docker Desktop)

## First time
1. Install Docker Desktop (WSL2 backend) and start it.
2. In the project folder (PowerShell):
   ```powershell
   copy .env.example .env
   python -c "import secrets; print(secrets.token_urlsafe(48))"   # run 4 times, paste into .env
   ```
   Fill OWNER_DB_PASSWORD, APP_DB_PASSWORD, SECRET_KEY and IP_HASH_SALT with those values.
3. Start the stack:
   ```powershell
   docker compose up --build -d
   docker compose ps
   curl.exe http://127.0.0.1:8000/api/health
   ```
   Expected: `"database": true`, `"migration": "0001"`, `"tables": 34` (33 app tables + PostGIS `spatial_ref_sys`) and `"categories": 7`.
4. Run the tests inside the container:
   ```powershell
   docker compose run --rm api python -m pytest -q
   ```

## Useful commands
| Task | Command |
|---|---|
| See API logs | `docker compose logs -f api` |
| Stop | `docker compose down` |
| Wipe the database and start clean | `docker compose down -v` then `docker compose up --build -d` |
| Create an admin | `docker compose exec api python -m app.cli create-admin --phone 01XXXXXXXXX --name "Member A"` |
| Open a SQL shell | `docker compose exec db psql -U civicpulse_owner -d civicpulse` |

## Models (worker, later batch)
`docker compose run --rm worker python -m scripts.fetch_models` downloads CLIP and the text encoder once and saves them as safetensors in the `models` volume.
