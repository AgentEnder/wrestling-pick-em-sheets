import type { CardSummary } from "@/lib/client/cards-api";

interface ApiErrorBody {
  error?: string;
}

interface ApiDataEnvelope<T> {
  data: T;
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

async function requestNoContent(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
}

export function listTemplateCardsForAdmin(): Promise<CardSummary[]> {
  return requestJson<CardSummary[]>("/api/admin/template-cards");
}

export function createTemplateCardForAdmin(input?: {
  name?: string;
  isPublic?: boolean;
}): Promise<CardSummary> {
  return requestJson<CardSummary>("/api/admin/template-cards", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: input?.name,
      isPublic: input?.isPublic ?? true,
    }),
  });
}

export function updateTemplateCardForAdmin(
  cardId: string,
  input: {
    name?: string;
    isPublic?: boolean;
  },
): Promise<void> {
  return requestNoContent(`/api/admin/template-cards/${cardId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export function deleteTemplateCardForAdmin(cardId: string): Promise<void> {
  return requestNoContent(`/api/admin/template-cards/${cardId}`, {
    method: "DELETE",
  });
}
