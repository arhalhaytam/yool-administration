# CAHIER DES CHARGES
## Système de Résumé Automatique en Temps Réel des Séances Pédagogiques
### Intégration à la Plateforme Yool Education

---

## Problématique

Les séances pédagogiques en direct sur Yool Education génèrent un contenu riche qui disparaît dès la fin du cours. L'objectif est de construire un système qui transcrit, analyse et résume automatiquement chaque séance en temps réel, et met ce résumé à disposition des étudiants immédiatement après.

---

## Approche retenue — Plugin Autonome

Le système est développé comme une application web indépendante que l'enseignant ouvre en parallèle de sa session Yool, sans aucune modification du code source de la plateforme. L'enseignant clique sur « Démarrer », parle normalement pendant son cours, puis clique sur « Terminer » — le résumé est généré et accessible aux étudiants inscrits.

Cette approche a été choisie parce qu'elle :
- Ne nécessite aucun accès au code source de Yool
- Est développable et démontrable de façon totalement indépendante
- Ouvre la voie à une intégration native future si Yool le souhaite

---

## Stack Technique

| Composant | Choix | Pourquoi |
|---|---|---|
| Frontend | Next.js 14 | SSR · React · streaming UI pour le transcript live |
| Backend | 4 microservices FastAPI | Séparation claire des responsabilités · async · OpenAPI auto |
| Transcription | faster-whisper medium | Open-source · meilleur modèle pour l'arabe et le français · CPU |
| Diarisation | pyannote-audio | Identification automatique Enseignant vs Étudiants |
| LLM | Gemini 2.0 Flash | Meilleur support darija · ~0,01 €/séance · quota gratuit suffisant |
| Embeddings | Gemini text-embedding-004 | Inclus dans la même API · recherche sémantique multilingue |
| Base de données | PostgreSQL 16 + pgvector | Données relationnelles + recherche vectorielle dans un seul moteur |
| Cache / Stream | Redis 7 | File de messages temps réel · expiration automatique 24h |
| Auth | JWT RS256 | Tokens signés · RBAC (Admin / Enseignant / Étudiant) |
| Infra | Docker Compose + Nginx | Un seul lancement · déploiement local dans un premier temps |

---

## Architecture en un schéma

```
Navigateur (micro)
      │ WebSocket · PCM audio
      ▼
   NGINX ──────────────────────────────────────────────────────┐
      │                                                         │
  ┌───▼──────┐  ┌─────────────────┐  ┌──────────┐  ┌─────────┐ │
  │   Auth   │  │   STT Service   │  │ Session  │  │  Query  │ │
  │  :8001   │  │    :8003        │  │  :8002   │  │  :8004  │ │
  └──────────┘  │                 │  └────┬─────┘  └────┬────┘ │
                │ ① VAD (10s)     │       │              │      │
                │ ② Diarisation   │       │              │      │
                │ ③ Whisper       │       │              │      │
                │ ④ Langue/MSA    │       │              │      │
                │ ⑤ Redis stream  │       │              │      │
                │ ⑥ LLM 3 min     │       │              │      │
                │ ⑦ Consolidation │───────┘              │      │
                └─────────────────┘                      │      │
                      │                                  │      │
                      ▼                                  ▼      │
              Gemini 2.0 Flash API          PostgreSQL + pgvector
              text-embedding-004                  Redis 7
```

---

## Gestion du multilinguisme et du darija

Whisper détecte automatiquement la langue de chaque segment (arabe, français, anglais). Si du darija est détecté, le modèle Gemini reçoit une instruction explicite pour normaliser le contenu en arabe standard (MSA). Le résumé final est toujours produit dans la langue dominante de la séance, en MSA pour l'arabe — jamais en dialecte.

---

## Sécurité — Points essentiels

- L'audio brut n'est jamais stocké — capturé, transcrit, supprimé
- Les données personnelles sont filtrées avant chaque appel API (noms, emails, téléphones)
- Accès contrôlé par rôle : l'étudiant ne voit que ses cours, l'enseignant que ses séances
- Consentement explicite obligatoire avant tout démarrage de séance

---

## Ce que j'attends de cette validation

Je souhaite obtenir la validation de l'approche et du stack avant de démarrer le développement, afin de m'assurer que :

1. L'approche plugin (sans modification de Yool) est acceptable
2. L'utilisation de l'API Gemini 2.0 Flash comme modèle principal est validée
3. Le périmètre fonctionnel (transcription + résumé + dashboard) correspond aux attentes

Le développement débutera en **Phase 1** dès validation : infrastructure Docker, pipeline audio temps réel, intégration Whisper + Gemini.

---

*Avril 2026*
