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
docker compose up -d
```

→ **http://localhost:48432**

Das war's. Erster Start erstellt automatisch ein Admin-Passwort (in den Logs sichtbar):

```bash
docker logs logistix | grep "Generated admin"
```

---

## Architektur

```
logistix/
├── server.js          ← Node.js Server (Auth, Storage API, Static Files)
├── public/
│   ├── index.html     ← Shell + Storage-Bridge
│   └── game.js        ← Komplettes Spiel (~950 KB, concatenated Build)
├── docker-compose.yml
├── Dockerfile
└── /data/             ← Persistent Volume (im Container)
    ├── users.json     ← Accounts (scrypt-gehasht)
    ├── admin.json     ← Admin-Config
    ├── shared.json    ← Leaderboard, Events, Marktplatz
    └── saves/         ← Spielstände (1 Datei pro User)
```

**Single-File-Game:** Das gesamte Spiel (15.000+ LOC JavaScript, CSS, HTML-Templates) wird in eine einzige `game.js` gebaut. Keine Bundler, keine Frameworks — pures JS mit einem Custom-Build-Script.

---

## Konfiguration

Alle Einstellungen über `docker-compose.yml` → `environment`:

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `PORT` | `48432` | Server-Port |
| `DATA_DIR` | `/data` | Persistenter Speicher |
| `CORS_ORIGIN` | `*` | Erlaubte Origins (z.B. `https://logistix.meinedomain.de`) |
| `RATE_MAX` | `200` | Max Requests/Minute/IP |
| `ADMIN_USER` | `riggouh` | Standard-Admin-Username |
| `ADMIN_DEFAULT_PW` | *(random)* | Admin-Passwort (nur beim Erststart) |
| `TRUST_PROXY` | `0` | `1` = X-Forwarded-For für Rate-Limiting (hinter Reverse Proxy) |
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
| Sessions | 32 Byte Random Token, 24h TTL |
| Auth Rate-Limiting | 5 Versuche / 5 Min pro User |
| API Rate-Limiting | 200 req/min/IP (konfigurierbar) |
| Storage-Isolation | Per-User Save-Files, Key-Allowlist |
| Write-Access-Control | Nur eigene `lx_save_*` + `lb:*` Keys, Session-Pflicht |
| Shared Keys | `pm:`, `alliances`, `terr_*` erfordern gültige Session |
| CSP | `script-src 'self' 'unsafe-inline'`, kein `unsafe-eval` |
| Prototype Pollution | `__proto__`, `constructor`, `prototype` blockiert |
| Auto-Migration | SHA-256 → scrypt beim Login, Client-Accounts → Server |

---

## Server-API

### Auth Endpoints (`POST /api/auth/<action>`)

| Endpoint | Beschreibung | Auth |
|----------|-------------|------|
| `login` | Login → Session-Token | — |
| `register` | Account erstellen | — |
| `reset1` | Sicherheitsfrage abrufen | — |
| `reset2` | Passwort zurücksetzen | — |
| `changepw` | Passwort ändern | Session |
| `ensuretest` | Test-Account sicherstellen | — |
| `admin` | Admin-Login | — |
| `checkadmin` | Admin-Status prüfen | Session |
| `users` | Alle User abrufen | Admin |
| `adminusers` | Admin-Liste | Admin |
| `addadmin` / `removeadmin` | Admin hinzufügen/entfernen | Admin |
| `adminpw` | Admin-Passwort ändern | Admin |

### Storage API (`/api/storage`)

| Method | Beschreibung |
|--------|-------------|
| `GET ?key=...&shared=...` | Wert lesen |
| `POST {key, value, shared}` | Wert schreiben (Session-Pflicht für geschützte Keys) |
| `DELETE ?key=...&shared=...` | Wert löschen |
| `GET /api/storage/list?prefix=...` | Keys auflisten |

Session-Token wird per `X-Session` Header übertragen.

---

## Entwicklung

### Quellcode builden (optional)

Falls du den Quellcode (`logistix-project`) hast:

```bash
cd logistix-project
npm install        # nur beim ersten Mal
node build.mjs     # → public/index.html + public/game.js
```

Build-Artefakte in das Docker-Repo kopieren:

```bash
cp public/* ../logistix-docker/public/
```

### Nützliche Befehle

```bash
docker compose up -d              # Starten
docker compose down                # Stoppen
docker compose restart             # Neustarten
docker logs -f logistix            # Logs verfolgen
docker exec -it logistix sh        # Shell im Container

# Backup
docker cp logistix:/data ./backup-$(date +%F)

# Update (nach git pull)
docker compose up -d --build
```

---

## Admin-Panel

Im Spiel → Hamburger-Menü → Admin. Enthält:

- 📊 **Übersicht** — Spieler-Stats, Geld-Verteilung, Server-Status
- 👥 **Spieler** — Accounts verwalten, Geld senden, Saves reparieren
- 📈 **Verlauf** — Wachstums-Charts
- 📋 **Log** — Auth-Events, Admin-Aktionen
- 🔧 **Tools** — Broadcast, Events, Geld-Reset
- 📝 **Release** — Server-Konfiguration (Dropdown-Anleitungen), Security-Audit-Status

---

## Changelog v2.2

**Security:** scrypt Passwort-Hashing · Auto-Migration SHA-256→scrypt · CSP `unsafe-eval` entfernt · checkWriteAccess Session-Pflicht · Username-Enumeration behoben · JSON.parse abgesichert · X-Forwarded-For Rate-Limiting · City-Namen XSS-Sanitierung

**Code:** 0 catch(e){} · 0 typeof-Guards · Accessor-Layer (getMoney/getVehicles/getOrders) · C() Map-Lookup · Cx() LRU-Cache · companyValue() gecacht · Async Offline-Catch-up · server_auth.js Bridge

**UI/UX:** Helleres Farbschema · WCAG AA Kontrast · Escape-Key · Dashboard entdoppelt · Order-Cards Progressive Disclosure · Toast-Stacking · Skeleton-Loader · Expandable Terminal-Suche · Phone Top-Bar vereinfacht · Pull-to-Refresh · Haptic Feedback

---

<p align="center">
  <sub>LogistiX v2.2 · © 2024–2026 Rico · All Rights Reserved</sub>
</p>
