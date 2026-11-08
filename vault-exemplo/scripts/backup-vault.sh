#!/usr/bin/env bash
# Compacta o Vault em ../backups com data no nome
set -e
mkdir -p ../backups
tar -czf "../backups/vault-$(date +%F).tar.gz" --exclude=node_modules .
echo "Backup criado em ../backups/vault-$(date +%F).tar.gz"
