# Système de Résumé Automatique des Séances Pédagogiques
## Plugin IA Autonome — Yool Education
### Présentation du Projet · PFE 2025–2026

---

## Contexte

La plateforme **Yool Education** organise des séances de cours en direct entre enseignants et étudiants. À la fin de chaque séance, le contenu échangé est perdu : aucun mécanisme ne valorise automatiquement ces échanges pédagogiques.

## Solution Proposée

Un **plugin autonome alimenté par l'IA** qui capture l'audio d'une séance en direct, le transcrit en temps réel, identifie les intervenants, et génère automatiquement un résumé structuré à la fin du cours — sans modifier le code de Yool Education.

## Fonctionnalités Clés

- Capture audio en temps réel via le navigateur (aucune installation requise)
- Transcription automatique multilingue : arabe, français, anglais, darija
- Identification des intervenants (enseignant / étudiants)
- Génération de résumés partiels toutes les 3 minutes durant la séance
- Résumé final structuré : points clés, Q&R, glossaire, quiz de révision
- Recherche sémantique dans l'historique des séances
- Interface dédiée pour les enseignants et les étudiants

## Architecture

```
Navigateur (Enseignant)
   └─ Capture Micro (MediaRecorder API)
         │  WebSocket
         ▼
   [STT Service]  ──► VAD → Transcription (Whisper) → Diarisation (pyannote)
         │
         ▼
   [LLM Service]  ──► Résumé partiel (toutes les 3 min) → Résumé final
         │
         ▼
   [Stockage]     ──► PostgreSQL (résumés) · Redis (cache temps réel)
         │
         ▼
   Navigateur (Étudiant)
   └─ Tableau de bord · Résumés · Recherche
```

## Technologies Utilisées

| Couche | Technologie | Rôle |
|---|---|---|
| Frontend | Next.js 14 | Interface plugin enseignant & étudiant |
| Backend API | FastAPI (Python 3.12) | Orchestration des services |
| Transcription | faster-whisper large-v3 | STT multilingue temps réel |
| Diarisation | pyannote-audio 3.x | Identification des intervenants |
| Détection vocale | silero-vad | Segmentation de la parole |
| LLM (local) | Ollama · Qwen2.5:14b | Résumé IA en développement |
| LLM (production) | Google Gemini 2.0 Flash | Résumé IA en production |
| Base de données | PostgreSQL 16 + pgvector | Stockage & recherche sémantique |
| Cache | Redis 7 | Flux temps réel & résumés partiels |
| Conteneurisation | Docker + Docker Compose | Déploiement unifié |
| Proxy | Nginx | Routage, HTTPS, sécurité |

## Sécurité

- Aucun audio brut stocké — traitement à la volée uniquement
- Authentification JWT avec contrôle d'accès par rôle (RBAC)
- Filtrage automatique des données personnelles avant envoi au LLM
- Consentement explicite obligatoire avant toute session
- Journal d'audit immuable · Conformité RGPD & Loi 18-07

---

*Projet de Fin d'Études — Mars 2026*
