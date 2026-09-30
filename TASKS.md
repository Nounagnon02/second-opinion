# Backlog — Second Opinion

Règles : une tâche = une itération de la boucle. Cocher `[x]` uniquement quand le critère « Fini quand » est vérifié.
Marquer `[!]` une tâche bloquée et expliquer pourquoi dans `.loop/BLOCKED.md`. Les tâches `[H]` sont réservées à l'humain : ne pas les faire.

## Phase 0 — Mise en place
- [x] T0.1 Initialiser le projet TypeScript (package.json, tsconfig, ESLint, Vitest, scripts build/lint/typecheck/test). Fini quand : `npm run build && npm test` passe avec un test factice.
- [x] T0.2 `.gitignore`, `.env.example`, hook pre-commit qui lance `scripts/check-secrets.sh`. Fini quand : un commit contenant une fausse clé est refusé.
- [x] T0.3 Vérifier la présence de `CMC_API_KEY` dans `.env`. Si absente, marquer `[!]` avec la raison et passer aux tâches faisables en mode replay.

## Phase 1 — Découverte de l'API
- [x] T1.1 Lire la doc CMC (générale + RWA) et lister les endpoints candidats pour C1 à C7 dans `docs/ENDPOINTS.md`.
- [x] T1.2 Appeler chaque endpoint candidat avec la vraie clé, enregistrer une réponse brute (clé masquée) dans `fixtures/`, noter accessibilité avec le plan Startup, coût en crédits, champs réels. Fini quand : chaque ligne de `docs/ENDPOINTS.md` a le statut vérifié / refusé.
- [x] T1.3 Adapter la liste des contrôles au résultat de T1.2 (retirer ou remplacer ce qui n'est pas accessible) et le consigner dans `docs/DECISIONS.md`.

## Phase 2 — Socle
- [x] T2.1 Client CMC : clé depuis l'env, erreurs, retries, cache TTL, compteur de crédits, plafond. Tests unitaires.
- [x] T2.2 Modes `--record` et `--replay`. Fini quand : les tests tournent sans réseau.
- [x] T2.3 Modèle normalisé + normaliseurs pour chaque source vérifiée. Tests sur fixtures.

## Phase 3 — Moteur
- [x] T3.1 C3 fraîcheur + C7 schéma (les plus simples, utiles à l'audit).
- [x] T3.2 C1 et C2 écarts de prix.
- [x] T3.3 C4 liquidité fantôme.
- [x] T3.4 C5 RWA (prime/décote, comparaison entre wrappers).
- [x] T3.5 C6 cohérence inter-endpoints.
- [x] T3.6 Score + verdict, pondérations dans `config/`. Tests.
- [x] T3.7 CLI `npm run check -- <symbole>`.

## Phase 4 — Calibration
- [x] T4.1 Enregistrer les données des 50 premières cryptos, lancer le score, produire `docs/CALIBRATION.md`.
- [x] T4.2 Ajuster seuils/pondérations jusqu'à ≥ 90 % d'`ACT` sur ce panel, sans rendre le moteur aveugle (garder au moins un cas de test qui doit rester en CAUTION ou DO_NOT_ACT). Documenter les choix.

## Phase 5 — MCP et agent
- [x] T5.1 Serveur MCP (stdio) avec `check_asset`, `check_rwa_token`, `preflight_trade`, `explain`. Tests.
- [x] T5.2 Exemple de configuration MCP dans le README, testé en lançant le serveur.
- [x] T5.3 Agent de démo : scénario refus (RWA) et scénario accord, sur données capturées réelles. Aucune transaction réelle.

## Phase 6 — Audit de l'API
- [x] T6.1 Commande `npm run audit` → `docs/API_AUDIT.md` + `docs/api_audit.json`.
- [x] T6.2 Relire chaque constat : preuve présente, formulation neutre et constructive. Retirer tout constat non prouvé.

## Phase 7 — Web
- [x] T7.1 Interface Next.js : recherche, verdict, contrôles, preuves, page audit. Clé côté serveur seulement.
- [x] T7.2 Configuration Vercel prête (`vercel.json` si besoin, instructions dans le README).

## Phase 8 — Livrables
- [x] T8.1 README anglais : problème, solution, démarrage < 5 min, config MCP, architecture, endpoints utilisés.
- [x] T8.2 `docs/EVIDENCE.md` : extraits de code + réponses réelles correspondantes.
- [x] T8.3 `docs/API_FEEDBACK.md` : ce que l'API a permis, ce qui a gêné, suggestions (nourri par l'audit).
- [x] T8.4 `docs/SUBMISSION.md` : texte prêt à coller dans DoraHacks (track, description, endpoints, liens à compléter).
- [x] T8.5 `docs/VIDEO_SCRIPT.md` : script de ~90 s, plan par plan, commandes à taper.
- [x] T8.6 `docs/X_POST.md` : brouillon du post avec emplacements pour le lien DoraHacks et la vidéo, #BuildwithCMC.
- [x] T8.7 `docs/HUMAN_CHECKLIST.md` : liste ordonnée des actions humaines restantes.

## Phase 9 — Vérification finale
- [x] T9.1 Installation propre dans un dossier temporaire : install, build, lint, typecheck, test.
- [x] T9.2 Vérifier chaque critère de la section 8 du cahier des charges ; consigner le résultat dans `docs/FINAL_CHECK.md`.
- [x] T9.3 `scripts/check-secrets.sh --history` : aucune clé dans l'historique git.

## Tâches humaines
- [H] Compte CMC + inscription DoraHacks (même e-mail) + clé dans `.env`
- [H] Dépôt GitHub public
- [H] Déploiement Vercel + variable `CMC_API_KEY`
- [H] Enregistrement de la vidéo
- [H] Publication du post X et soumission du BUIDL
- [H] Relecture du ton du rapport d'audit
