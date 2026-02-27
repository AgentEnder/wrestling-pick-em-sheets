import type { CardLiveKey, CardLiveKeyPayload } from "@/lib/types";

interface ApiErrorBody {
  error?: string;
}

interface ApiDataEnvelope<T> {
  data: T;
}

export interface LiveKeyStateResponse {
  key: CardLiveKey;
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

export function getLiveKeyState(cardId: string): Promise<LiveKeyStateResponse> {
  return requestJson<LiveKeyStateResponse>(`/api/cards/${cardId}/live-key`);
}

export function saveLiveKey(
  cardId: string,
  payload: CardLiveKeyPayload,
): Promise<CardLiveKey> {
  return requestJson<CardLiveKey>(`/api/cards/${cardId}/live-key`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
