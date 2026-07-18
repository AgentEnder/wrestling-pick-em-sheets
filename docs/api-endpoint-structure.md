# API Endpoint Structure (Frontend Handoff)

This document describes the backend HTTP contract currently implemented for the app.

## Scope

- Single model for UI work: `cards` endpoints.
- Legacy `sheets` endpoints were removed.

## Auth & Permissions

Auth is Clerk-based on server routes.

- Read access rule:
  - signed-out user: `public === true` cards only
  - signed-in user: cards where `owner_id === userId` OR `public === true` OR the user is a collaborator (`card_collaborators`)
- Write access rule:
  - create requires signed-in user
  - update/save requires signed-in owner or collaborator
  - archive/unarchive and sharing management (invites/collaborators) require the owner

Status conventions:

- `401` Unauthorized: signed-in user required.
- `404` Not found: record missing or not writable/readable for that user.
- `400` Invalid request body: fails Zod validation (`issues` array returned).

## Response Envelope

All successful JSON endpoints use:

- `{ "data": ... }`

Error JSON endpoints use:

- `{ "error": "..." }`
- For validation failures, also:
  - `{ "issues": [...] }`

## Card Sharing API

Collaboration is invite-link based. All sharing management endpoints are owner-only.

- `GET /api/cards/:cardId/invites` — list active (non-revoked) invite links.
- `POST /api/cards/:cardId/invites` — create an invite link; returns `{ id, cardId, token, createdBy, createdAt, revokedAt }`. The shareable URL is `/cards/invite/<token>`.
- `DELETE /api/cards/:cardId/invites/:inviteId` — revoke an invite link (`204`).
- `GET /api/cards/:cardId/collaborators` — list collaborators (`{ id, cardId, userId, userEmail, addedAt }`).
- `DELETE /api/cards/:cardId/collaborators/:collaboratorUserId` — remove a collaborator. The owner can remove anyone; a collaborator can remove themselves (leave).

Invite acceptance (signed-in caller; not owner-scoped):

- `GET /api/card-invites/:token` — preview `{ cardId, cardName, eventName, viewerIsOwner, viewerIsCollaborator }`; `404` if revoked/expired/unknown.
- `POST /api/card-invites/:token/accept` — accept; returns `{ status: "joined" | "already-collaborator" | "owner", cardId }`; `404` if the link is no longer valid.

## Cards API

Base path: `/api/cards`

### `GET /api/cards`

Returns readable card summaries for current viewer.

Response `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "ownerId": "user_123 | null",
      "templateCardId": "uuid | null",
      "name": "string",
      "isPublic": true,
      "isTemplate": false,
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime"
    }
  ]
}
```

### `GET /api/cards/:cardId`

Returns resolved card data for rendering/editing.

Response `200`:

```json
{
  "data": {
    "id": "uuid",
    "ownerId": "user_123 | null",
    "templateCardId": "uuid | null",
    "isPublic": false,
    "isTemplate": false,
    "name": "string",
    "eventName": "string",
    "eventDate": "string",
    "eventTagline": "string",
    "defaultPoints": 1,
    "tiebreakerLabel": "string",
    "matches": [
      {
        "id": "uuid",
        "type": "standard",
        "title": "string",
        "description": "string",
        "participants": ["string"],
        "bonusQuestions": [],
        "points": 1
      },
      {
        "id": "uuid",
        "type": "battleRoyal",
        "title": "string",
        "description": "string",
        "announcedParticipants": ["string"],
        "surpriseSlots": 5,
        "bonusQuestions": [],
        "points": 1
      }
    ],
    "createdAt": "ISO datetime",
    "updatedAt": "ISO datetime"
  }
}
```

### `POST /api/cards/from-template`

Creates a new private user card from a public template card.

Request body:

```json
{
  "templateCardId": "uuid"
}
```

### `PATCH /api/cards/:cardId/overrides`

Updates card-level override fields for an owned derived card.

Request body (all optional, at least one required):

```json
{
  "name": "string | null",
  "eventName": "string | null",
  "eventDate": "string | null",
  "eventTagline": "string | null",
  "defaultPoints": 1,
  "tiebreakerLabel": "string | null"
}
```

### `PUT /api/cards/:cardId`

Persists full card editor state for an owned card (event details + match list).

Request body:

```json
{
  "eventName": "string",
  "eventDate": "string",
  "eventTagline": "string",
  "defaultPoints": 1,
  "tiebreakerLabel": "string",
  "matches": [
    {
      "id": "uuid",
      "type": "standard",
      "title": "string",
      "description": "string",
      "participants": ["string"],
      "bonusQuestions": [
        {
          "id": "uuid",
          "question": "string",
          "points": 1,
          "answerType": "write-in",
          "options": []
        }
      ],
      "points": 1
    }
  ]
}
```

Behavior:

- base card (`templateCardId = null`): writes fields directly to card + replaces stored match list.
- derived card (`templateCardId != null`): writes card overrides, hides inherited template matches, and stores current editor matches as custom matches.

Response `200`: returns resolved saved card payload.

## Recommended Frontend Flow

1. call `GET /api/cards`
2. select or create via `POST /api/cards/from-template`
3. call `GET /api/cards/:cardId`
4. auto-save top-level field edits with `PATCH /api/cards/:cardId/overrides`
5. explicit full save with `PUT /api/cards/:cardId`
