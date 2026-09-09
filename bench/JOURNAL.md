# Journal d'optimisation

Métrique principale : temps login → son, durée du service `hearing-aids-connect` (`bench/login-time`). Une mesure par reboot.

| # | Hypothèse | Fichiers | Résultat | Δ métrique | Δ garde-fous | Verdict |
|---|-----------|----------|----------|-----------|--------------|---------|
| 0 | Baseline, commit 0015eea, 3 boots valides | bench/baseline.json | pre 8,7 s fixes, connect 7,8 à 17,3 s, sonde 4,0 s ; total médian 20,9 s | — | CPU service 0,6 à 0,9 s | Référence |
| 0b | L'extension coûte du CPU à gnome-shell au repos | extension.js | 13,6 % activée, 13,8 % désactivée, 13,8 % réactivée (6 × 5 s) ; 0 signal BlueZ en 60 s au repos | bruit | — | Rien à optimiser |
| 0c | Délai de reprise du son après silence (0,86 s mesuré le 05/09) | règle WirePlumber suspend 300 s (hors dépôt, exemple versionné) | plus de recréation des CIS à la reprise | −0,86 s par reprise | batterie : 5 jours de relevés, non concluant (min 80/80/60 % selon les jours, usage non contrôlé) | Retenu le 05/09, à surveiller |
| 1 | La phase « pre » (8,7 s) est un `sleep 8` qui attend l'enregistrement des endpoints BAP de WirePlumber, enregistrés 0,1 à 0,6 s après son démarrage : attendre cet enregistrement (`Media1.SupportedUUIDs` contient 0x2BC9) au lieu de dormir | scripts/connect-hearing-aids, systemd/user/hearing-aids-connect.service | Attente seule : 0,05 s médiane sur 10 runs endpoints présents ; chemin normal complet 4,6 s | attendu −8 s sur 20,9 s (−38 %), **à confirmer au prochain boot** avec `bench/login-time` | CPU script inchangé | Commité, validation boot en attente |
