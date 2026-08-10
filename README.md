# COOPECI-DC — Backend API

Backend Node.js/Express/MongoDB de la plateforme COOPECI-DC (Coopérative d'Épargne, de Crédit et d'Investissement Debout Congolais). Il alimente les trois clients : application **Membre** (mobile Expo), application **Agent** (POS), back-office **Admin** (web React).

> Passerelle de paiement : **Multipay** (remplace Limoka). L'intégration est isolée derrière un *adapter* — voir la section dédiée.

---

## 1. Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
#    puis renseigner MONGODB_URI, JWT_SECRET, et les clés Multipay

# 3. Initialiser le super admin + comptes de démo
npm run seed

# 4. Lancer en développement
npm run dev
# ou en production
npm start
```

L'API écoute par défaut sur `http://localhost:5000`, préfixe `/api`.
Vérification : `GET /api/health`.

**Identifiants de démonstration** (après `npm run seed`) :
- Super admin : `admin@coopeci-dc.cd` / `ChangeMoi2026!` — **à changer immédiatement**
- Personnel : `directeur@ / credit@ / caisse@ / agent@ / comite@ coopeci-dc.cd` / `Passe2026!`

---

## 2. Architecture

```
src/
├── config/        env centralisé, MongoDB, Redis, JWT, Firebase
├── models/        11 modèles Mongoose (Member, Account, Transaction, Credit...)
├── controllers/   logique métier par domaine
├── routes/        définition + validation des endpoints
├── middleware/    auth, rôles, validation, audit, erreurs
├── services/
│   ├── payment/   ADAPTER MULTIPAY (le point clé)
│   ├── notificationService.js
│   ├── pdfGenerator.js
│   ├── reportGenerator.js
│   └── cacheService.js
├── utils/         logger, constantes, helpers (amortissement...), validateurs
├── app.js         application Express
scripts/seeder.js  initialisation
server.js          point d'entrée
```

Pile technique : Node 18+, Express 4, Mongoose 8, JWT, Redis (optionnel), Firebase Admin (optionnel), PDFKit, Winston. Déploiement cible : Render + MongoDB Atlas (même pipeline qu'Ekomi).

---

## 3. L'adapter Multipay

Toute la logique de paiement passe par une **interface abstraite** (`PaymentProvider`). Le reste de l'application n'importe jamais Multipay directement — elle appelle `paymentProvider()` qui retourne le bon provider selon `PAYMENT_PROVIDER` (`multipay` | `mock`).

```
services/payment/
├── PaymentProvider.js   interface abstraite + format normalisé
├── MultipayProvider.js  implémentation réelle (À COMPLÉTER via la doc Multipay)
├── MockProvider.js      simulateur pour dev/tests
└── index.js             fabrique (sélection par env)
```

Méthodes normalisées : `collect()` (encaissement), `disburse()` (décaissement), `getStatus()`, `verifyWebhook()`, `parseWebhook()`. Toutes renvoient un statut normalisé `pending | success | failed`, indépendant de l'API Multipay.

### Points à compléter d'après la doc Multipay
Cherchez les commentaires `TODO` dans `MultipayProvider.js` :
1. Chemins exacts des endpoints (`collect` / `payout` / `status`)
2. Schéma d'authentification (Bearer, HMAC, signature d'en-tête)
3. Noms des champs requête/réponse (téléphone, montant, id transaction)
4. Codes de statut Multipay → mapping `_mapStatus()`
5. Algorithme et en-tête de signature du webhook (`verifyWebhook`)

Tant que la doc n'est pas branchée, gardez `PAYMENT_PROVIDER=mock` : les flux dépôt/retrait/remboursement fonctionnent de bout en bout en simulation.

### Webhook
`POST /api/webhooks/multipay` reçoit les confirmations. Le corps brut est préservé (`express.raw`) pour vérifier la signature. Le traitement est **idempotent** (basé sur la référence interne) : un dépôt confirmé crédite le compte une seule fois, un remboursement impute l'échéance une seule fois.

---

## 4. Principaux endpoints

| Domaine | Exemples |
|---|---|
| Auth | `POST /auth/member/login`, `POST /auth/admin/login`, `POST /auth/refresh-token` |
| Membres | `POST /members/register`, `GET /members`, `GET /members/:id` |
| Comptes | `GET /accounts/:id/balance`, `POST /accounts/fixed-deposit` |
| Transactions | `POST /transactions/deposit/request`, `PUT /transactions/withdrawal/validate/:id` |
| Crédits | `POST /credits/applications`, `POST /credits/applications/:id/disburse`, `POST /credits/:id/repay` |
| Comité | `POST /committee/applications/:id/vote`, `GET /committee/pending` |
| Rapports | `GET /reports/dashboard`, `GET /reports/par` |
| Admin | `POST /admin/users`, `GET /admin/users` |
| Webhook | `POST /webhooks/multipay` |

Authentification par Bearer JWT. Deux types d'acteurs : `member` (app mobile) et `user` (personnel). Les rôles : `super_admin, director, credit_manager, cashier, agent, committee_member, viewer`.

---

## 5. Logique crédit

`utils/helpers.js → amortizationSchedule()` calcule l'échéancier à mensualités constantes (capital + intérêts). Au décaissement (`/credits/applications/:id/disburse`), le crédit et son échéancier complet sont générés, puis le montant est versé soit sur le compte épargne, soit par mobile money. Les remboursements imputent chaque échéance et clôturent le crédit à solde nul.

---

## 6. Sécurité & conformité

Helmet, CORS restreint, rate limiting (global + auth renforcé), sanitisation Mongo, HPP, hachage bcrypt (PIN membres + mots de passe personnel), verrouillage après N tentatives, JWT access/refresh, et **journal d'audit** (`AuditLog`) sur toutes les actions sensibles pour la traçabilité BCC.

---

## 7. Déploiement (Render)

1. Créer un service web Node, `Build: npm install`, `Start: npm start`.
2. Variables d'environnement : copier `.env.example` et renseigner les vraies valeurs.
3. `MULTIPAY_CALLBACK_URL` = `https://<votre-service>.onrender.com/api/webhooks/multipay`.
4. MongoDB Atlas : autoriser l'IP `0.0.0.0/0` ou l'IP sortante Render.

---

© ROOKSECURITY SARL — Gad NSIMBA. Livré pour COOPECI-DC.
