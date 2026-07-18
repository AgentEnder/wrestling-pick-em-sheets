interface ApiErrorBody {
  error?: string;
}

interface ApiDataEnvelope<T> {
  data: T;
}

export interface CardInviteSummary {
  id: string;
  cardId: string;
  token: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface CardCollaboratorSummary {
  id: string;
  cardId: string;
  userId: string;
  userEmail: string | null;
  addedAt: string;
}

export interface CardInvitePreview {
  cardId: string;
  cardName: string;
  eventName: string;
  viewerIsOwner: boolean;
  viewerIsCollaborator: boolean;
}

export interface AcceptCardInviteResult {
  status: "joined" | "already-collaborator" | "owner";
  cardId: string;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error && body.error.trim()) {
      return body.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const body = (await response.json()) as ApiDataEnvelope<T>;
  return body.data;
}

export function listCardInvites(cardId: string): Promise<CardInviteSummary[]> {
  return requestJson<CardInviteSummary[]>(`/api/cards/${cardId}/invites`);
}

export function createCardInvite(cardId: string): Promise<CardInviteSummary> {
  return requestJson<CardInviteSummary>(`/api/cards/${cardId}/invites`, {
    method: "POST",
  });
}

export async function revokeCardInvite(
  cardId: string,
  inviteId: string,
): Promise<void> {
  const response = await fetch(`/api/cards/${cardId}/invites/${inviteId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
}

export function listCardCollaborators(
  cardId: string,
): Promise<CardCollaboratorSummary[]> {
  return requestJson<CardCollaboratorSummary[]>(
    `/api/cards/${cardId}/collaborators`,
  );
}

export async function removeCardCollaborator(
  cardId: string,
  collaboratorUserId: string,
): Promise<void> {
  const response = await fetch(
    `/api/cards/${cardId}/collaborators/${encodeURIComponent(collaboratorUserId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
}

export function getCardInvitePreview(
  token: string,
): Promise<CardInvitePreview> {
  return requestJson<CardInvitePreview>(
    `/api/card-invites/${encodeURIComponent(token)}`,
  );
}

export function acceptCardInvite(
  token: string,
): Promise<AcceptCardInviteResult> {
  return requestJson<AcceptCardInviteResult>(
    `/api/card-invites/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
    },
  );
}

export function cardInviteUrl(token: string): string {
  return `${window.location.origin}/cards/invite/${encodeURIComponent(token)}`;
}
