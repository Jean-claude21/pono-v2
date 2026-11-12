# Pono dans les agents de code (D-021)

Ce qu'un agent et la personne doivent savoir du projet du dossier courant — serveur, serveur de dev,
adresse de preview, branche, fichiers modifiés, règle de mise en ligne — sans le demander.

## Claude Code : le plugin `claude-code/`

Il apporte :

- **le serveur MCP de Pono** (`.mcp.json`), lu depuis `PONO_URL` et `PONO_TOKEN` ;
- **un hook de début de session** : à chaque session dans un dossier suivi par Pono, l'agent reçoit
  le projet, l'état de son serveur, l'adresse de preview et les skills à suivre ;
- **des commandes** : `/pono:status`, `/pono:logs`, `/pono:ship`.

Installation :

```bash
export PONO_URL=https://<adresse-de-pono>      # la console
export PONO_TOKEN=pono_…                        # Agents → donner un accès (lecture et actions)
claude --plugin-dir /chemin/vers/pono/integrations/claude-code
```

**Ligne de statut** (sous la saisie, rafraîchie chaque minute) : dans `~/.claude/settings.json` :

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /chemin/vers/pono/integrations/claude-code/scripts/pono.mjs statusline"
  }
}
```

Elle affiche par exemple :
`pono · lectio · server running · dev running · e00d…agent37.app · 2 changed · release ask`.

Sans `PONO_URL` ou `PONO_TOKEN`, ou dans un dossier que Pono ne suit pas, le script ne dit rien et
ne bloque jamais la session.

## Codex : `codex/`

- `config.toml` : le serveur MCP de Pono (à ajouter à `~/.codex/config.toml`) ;
- `AGENTS.md` : la conduite à tenir, à coller dans l'`AGENTS.md` du projet.

Codex reçoit les mêmes outils ; il n'a pas, à notre connaissance, l'équivalent du hook de début de
session ni de la ligne de statut : `AGENTS.md` lui demande d'appeler `dev_status` en début de
session.
