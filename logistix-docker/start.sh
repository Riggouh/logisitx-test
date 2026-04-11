#!/bin/bash
cd "$(dirname "$0")"
docker compose up -d --build 2>/dev/null || docker-compose up -d --build
echo "LogistiX gestartet auf Port 3914"
