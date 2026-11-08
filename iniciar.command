#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js em https://nodejs.org"; read -p "Enter para sair"; exit 1; }
(sleep 1.5; open "http://localhost:3333") &
node server.js
