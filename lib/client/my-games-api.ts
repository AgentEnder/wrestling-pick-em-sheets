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

export interface MyGameScore {
  totalScore: number;
  maxPossible: number;
  rank: number;
  playerCount: number;
}

export interface MyGameCompletedScore extends MyGameScore {
  scorePercentage: number;
  winnerPoints: number;
  bonusPoints: number;
  surprisePoints: number;
}

export interface MyActiveGame {
  gameId: string;
  cardName: string | null;
  eventName: string | null;
  promotionName: string | null;
  eventDate: string | null;
  status: "lobby" | "live";
  joinCode: string;
  score?: MyGameScore;
}

export interface MyCompletedGame {
  gameId: string;
  cardName: string | null;
  eventName: string | null;
  promotionName: string | null;
  eventDate: string | null;
  endedAt: string;
  joinCode: string;
  score: MyGameCompletedScore;
}

export interface MyGamesTrendPoint {
  eventName: string | null;
  scorePercentage: number;
  date: string;
}

export interface MyGamesStats {
  gamesPlayed: number;
  avgScorePercentage: number;
  bestScorePercentage: number;
  bestRank: string;
  trendData: MyGamesTrendPoint[];
}

export interface MyGamesResponse {
  activeGames: MyActiveGame[];
  completedGames: MyCompletedGame[];
  stats: MyGamesStats;
}

export function fetchMyGames(): Promise<MyGamesResponse> {
  return requestJson<MyGamesResponse>("/api/my-games");
}
