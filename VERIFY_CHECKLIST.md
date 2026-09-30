# Checklist de pré-soumission — Second Opinion

Une case = un contrôle vérifié **par une exécution réelle**, avec la preuve notée dans `.verify/NOTES.md` (commande lancée + résultat).
`[x]` fait et prouvé · `[ ]` à faire · `[!]` bloqué, raison dans `.loop/BLOCKED.md`.

## V — Tests de fumée
- [ ] V0 Écrire `scripts/smoke.sh` (exécutable, code de sortie ≠ 0 au premier échec) qui couvre au minimum : CLI `check` sur BTC et ETH (verdict ACT attendu) ; serveur MCP en stdio avec `initialize`, `tools/list` (les 4 outils présents) et un appel réel à `check_asset` ; les deux scénarios de l'agent de démo ; le build de l'interface web ; `npm run audit` en mode replay. Utilise les fixtures si `CMC_API_KEY` est absente, le réseau sinon, avec un plafond de crédits bas.
- [ ] V1 Lancer `scripts/smoke.sh` avec la vraie clé (mode live) et vérifier que les réponses ne sont pas des fixtures (horodatages récents).

## R — Conformité et honnêteté
- [ ] R1 Chaque constat de `docs/API_AUDIT.md` renvoie à une fixture qui existe et qui montre bien ce qui est affirmé. Supprimer tout constat non prouvé.
- [ ] R2 Aucune fixture, aucun log, aucun document ne contient la clé en clair.
- [ ] R3 Chaque endpoint cité dans `docs/SUBMISSION.md` est marqué vérifié dans `docs/ENDPOINTS.md` **et** est effectivement appelé dans `src/` (grep).
- [ ] R4 Les extraits de `docs/EVIDENCE.md` correspondent au code actuel et à des réponses réelles présentes dans `fixtures/`.
- [ ] R5 Aucun code n'envoie de transaction ou d'ordre réel.
- [ ] R6 Relancer la calibration : les chiffres de `docs/CALIBRATION.md` sont reproduits (≥ 90 % d'ACT sur le panel). Si non, corriger le **document** pour refléter la réalité, ne pas truquer le moteur.
- [ ] R7 Relecture du ton de `docs/API_AUDIT.md` et `docs/API_FEEDBACK.md` : neutre, constructif, aucune accusation.

## J — Grille des juges (100 points)
- [ ] J1 « Does it work » (30) : suivre le Quickstart du README **à la lettre** dans un clone propre ; il fonctionne sans étape implicite.
- [ ] J2 « Usefulness » (25) : les 10 premières lignes du README disent quel problème, pour qui, et ce que l'outil répond.
- [ ] J3 « Interesting use of the API » (20) : le README et la soumission expliquent le croisement de plusieurs endpoints ; ils sont listés.
- [ ] J4 « Code quality » (15) : lint et typecheck propres, pas de code mort ni de fichier temporaire committé, structure conforme au cahier des charges, configuration MCP d'exemple valide.
- [ ] J5 « Presentation » (10) : `docs/VIDEO_SCRIPT.md` tient en ~90 s, chaque commande citée fonctionne ; `docs/X_POST.md` fait moins de 280 caractères hors liens.

## H — Préparation humaine
- [ ] H1 `docs/HUMAN_CHECKLIST.md` liste, dans l'ordre, les actions restantes avec les commandes exactes, et rappelle la clôture : **30 septembre 2026, 23h59 UTC**. Tous les liens à fournir sont des emplacements `[[HUMAN: ...]]`.

## F — Fin
- [ ] F1 `scripts/presubmit.sh` passe sans FAIL. Écrire `docs/SUBMISSION_READINESS.md` (résumé des contrôles, points faibles restants, actions humaines) puis créer `.loop/READY`.
