# Pono

> **Pose. Ça tient.**

Le cadre unique de tous tes projets construits par agent : leur état réel, ce que te coûtent tes
abonnements, un serveur prêt pour chaque projet lancé depuis ta conversation, et une production
qui obéit à la règle que tu as choisie.

- Mandat : [docs/MANDAT.md](docs/MANDAT.md)
- Roadmap : [docs/ROADMAP.md](docs/ROADMAP.md)
- Décisions : [docs/DECISIONS.md](docs/DECISIONS.md)

## Développer

```bash
pnpm install
pnpm check      # types, lint, format, textes en dur
pnpm test       # tests, sur un Postgres 17 local lancé par les tests
pnpm dev:api    # API sur :8787
pnpm dev:web    # console sur :3000
```

Les variables sont documentées dans `.env.example`.

## Branches

```
main       le geste humain seul
dev        intégration, CI verte
NNN-slug   une phase Spec Kit
```
