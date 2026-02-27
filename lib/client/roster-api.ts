interface ApiErrorBody {
  error?: string;
}

interface ApiDataEnvelope<T> {
  data: T;
}

export interface RosterSuggestionsResponse {
  promotionName: string;
  leagueId: string | null;
  leagueName: string | null;
  names: string[];
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error?.trim()) {
      return body.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function getRosterSuggestions(
  promotionName: string,
  query?: string,
): Promise<RosterSuggestionsResponse> {
  const url = new URL("/api/roster-suggestions", window.location.origin);
  url.searchParams.set("promotionName", promotionName);
  url.searchParams.set("limit", "500");
  if (query?.trim()) {
    url.searchParams.set("q", query.trim());
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const body =
    (await response.json()) as ApiDataEnvelope<RosterSuggestionsResponse>;
  return body.data;
}
