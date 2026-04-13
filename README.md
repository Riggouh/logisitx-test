<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18_Alpine-339933?logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/Version-2.2-3dd68c" />
  <img src="https://img.shields.io/badge/License-Proprietary-red" />
</p>

<h1 align="center">🚛 LOGISTIX</h1>

<p align="center">
  <b>Baue dein globales Logistik-Imperium</b><br>
  <sub>Browser-basiertes Wirtschafts- & Logistikspiel · Single-File-Architektur · Self-Hosted</sub>
</p>

---

## Was ist LogistiX?

Ein Multiplayer-Logistikspiel im Browser. Kaufe Städte, baue Fabriken, produziere Waren und liefere sie mit deiner Fahrzeugflotte quer durch Europa — und darüber hinaus.

**Features:** Echtzeit-Produktion · 50+ Warentypen · Fahrzeugflotte (LKW → Containerschiffe → Frachtjets) · Allianzen · Spielermarkt · 10 Level-Stufen · Globale Map (OpenStreetMap) · Mobile-optimiert

---

## Quickstart

```bash
git clone <repo-url> logistix
cd logistix
docker compose up -d --build
```

→ **http://localhost:48432**

Erster Start erstellt automatisch ein Admin-Passwort (in den Logs sichtbar):

```bash
docker logs logistix | grep "Generated admin"
```

---

## Repo-Struktur

```
├── server.js              ← Node.js Server (Auth, Storage-API, Static Files)
├── public/
│   ├── index.html         ← Shell + Storage-Bridge (~86 KB)
│   ├── game.js            ← Komplettes Spiel (~958 KB, concatenated Build)
│   └── blueprint.jpg      ← Hintergrund-Grafik
├── docker-compose.yml     ← Docker-Konfiguration + ENV-Variablen
├── Dockerfile             ← Node 18 Alpine, kopiert server.js + public/
├── start.sh               ← docker compose up -d --build
├── stop.sh                ← docker compose down
├── package.json
└── LICENSE
```

**Persistente Daten** (im Docker-Volume `logistix-game-data`, gemountet auf `/data`):

```
/data/
├── users.json             ← Accounts (scrypt-gehasht)
├── admin.json             ← Admin-Config + Passwort-Hash
├── shared.json            ← Leaderboard, Events, Marktplatz
└── saves/                 ← Spielstände (1 JSON-Datei pro User)
    ├── riggouh.json
    ├── test.json
    └── ...
```

---

## Konfiguration

Alle Einstellungen über `docker-compose.yml` → `environment`:

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `PORT` | `48432` | Server-Port |
| `DATA_DIR` | `/data` | Persistenter Speicher (Docker-Volume) |
| `CORS_ORIGIN` | `*` | Erlaubte Origins (z.B. `https://logistix.meinedomain.de`) |
| `RATE_MAX` | `600` | Max Requests/Minute/IP |
| `ADMIN_USER` | `riggouh` | Standard-Admin-Username |
| `ADMIN_DEFAULT_PW` | *(random)* | Admin-Passwort (nur beim Erststart, danach in admin.json) |
| `TRUST_PROXY` | `0` | `1` aktivieren wenn hinter Reverse Proxy (Caddy/nginx) |
| `SESSION_TTL` | `86400000` | Session-Dauer in ms (Default: 24h) |

### Beispiel: Produktions-Setup

```yaml
environment:
  - CORS_ORIGIN=https://logistix.meinedomain.de
  - TRUST_PROXY=1
  - ADMIN_DEFAULT_PW=mein-sicheres-passwort
```

---

## Security

| Feature | Implementierung |
|---------|----------------|
| Passwort-Hashing | **scrypt** (N=16384, r=8, p=1, keylen=64) + Salt |
| Sessions | 32 Byte Random Token, 24h TTL, in-memory |
| Auth Rate-Limiting | 5 Versuche / 5 Min pro User |
| API Rate-Limiting | 600 req/min/IP (konfigurierbar) |
| Storage-Isolation | Per-User Save-Files in `/data/saves/` |
| Write-Access-Control | Session-Pflicht für `lx_save_*`, `lb:*`, shared Keys |
| CSP | `script-src 'self' 'unsafe-inline'` (kein `unsafe-eval`) |
| Prototype Pollution | `__proto__`, `constructor`, `prototype` blockiert |
| Auto-Migration | SHA-256 → scrypt beim Login, Client → Server Account-Migration |

---

## Server-API

### Auth (`POST /api/auth/<action>`)

| Endpoint | Beschreibung | Auth |
|----------|-------------|------|
| `login` | Login → Session-Token | — |
| `register` | Account erstellen (PW min. 8 Zeichen) | — |
| `reset1` | Sicherheitsfrage abrufen | — |
| `reset2` | Passwort zurücksetzen | — |
| `changepw` | Passwort ändern | Session |
| `admin` | Admin-Login | — |
| `checkadmin` | Admin-Status prüfen | Session |
| `users` | Alle User abrufen | Admin |
| `adminusers` | Admin-Liste | Admin |
| `addadmin` / `removeadmin` | Admin verwalten | Admin |
| `adminpw` | Admin-Passwort ändern | Admin |
| `ensuretest` | Test-Account anlegen | — |

### Storage (`/api/storage`)

| Method | Beschreibung |
|--------|-------------|
| `GET ?key=...&shared=...` | Wert lesen |
| `POST {key, value, shared}` | Wert schreiben |
| `DELETE ?key=...&shared=...` | Wert löschen |
| `GET /list?prefix=...&shared=...` | Keys auflisten |

Session-Token per `X-Session` Header. Geschützte Keys (`lx_save_*`, `lb:*`, `pm:*`, `alliances`, `terr_*`) erfordern gültige Session.

---

## Nützliche Befehle

```bash
# Starten / Stoppen
./start.sh                         # oder: docker compose up -d --build
./stop.sh                          # oder: docker compose down

# Logs
docker logs -f logistix

# Admin-Passwort anzeigen
docker logs logistix | grep "Generated admin"

# Shell im Container
docker exec -it logistix sh

# Backup
docker cp logistix:/data ./backup-$(date +%F)

# Update nach git pull
docker compose up -d --build
```

---

## Admin-Panel

Im Spiel erreichbar über Hamburger-Menü → Admin:

| Tab | Inhalt |
|-----|--------|
| 📊 Übersicht | Spieler-Stats, Geld-Verteilung, Server-Status |
| 👥 Spieler | Accounts verwalten, Geld senden, Saves reparieren |
| 📈 Verlauf | Wachstums-Charts |
| 📋 Log | Auth-Events, Admin-Aktionen |
| 🔧 Tools | Broadcast, Events, Geld-Reset |
| 🎲 Events | Markt-Events steuern |
| 🚨 Alerts | Anomalie-Erkennung |
| 📊 Feedback | Spieler-Feedback auswerten |
| 📝 Release | Server-Konfiguration (Dropdown-Anleitungen), Security-Audit-Status |

---

## Build (optional)

Das Repo enthält fertige Build-Artefakte (`public/game.js` + `public/index.html`). Falls du den Quellcode (`logistix-project`) bearbeiten und neu bauen willst:

```bash
cd logistix-project
npm install                        # einmalig
node build.mjs                     # erzeugt public/index.html + public/game.js
cp public/* ../logistix/public/    # in dieses Repo kopieren
```

---

## Changelog v2.2

**Security:** scrypt Hashing · CSP ohne `unsafe-eval` · Session-Pflicht für Storage-Writes · Username-Enumeration behoben · JSON.parse abgesichert · X-Forwarded-For Rate-Limiting · City-Namen XSS-Sanitierung · Server-Auth-Bridge (`server_auth.js`)

**Code:** 0 `catch(e){}` · 0 typeof-Guards · Accessor-Layer (getMoney/getVehicles/getOrders/spendMoney) · C() Map-Lookup · Cx() LRU-Cache · companyValue() gecacht · Async Offline-Catch-up

**UI/UX:** Helleres Farbschema · WCAG AA Kontrast · Escape-Key · Dashboard entdoppelt · Order-Cards Progressive Disclosure · Toast-Stacking (max 3) · Skeleton-Loader · Expandable Terminal-Suche · Phone Top-Bar vereinfacht · Pull-to-Refresh · Haptic Feedback · Blueprint-Hintergrund · Gebäude-Tab Ketten-Planer · Routen/DA Sub-Tabs

---

<p align="center">
  <sub>LogistiX v2.2 · © 2024–2026 Rico · All Rights Reserved</sub>
</p>
