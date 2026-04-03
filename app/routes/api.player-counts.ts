import { getGameServer } from "../../lib/gameServer.js";

export async function loader() {
  const server = getGameServer();
  const counts: Record<number, number> = {};
  for (const size of [4, 5] as const) {
    const lastRound = server.getLastRound(size);
    counts[size] = lastRound ? lastRound.results.players.length : 0;
  }
  return Response.json(counts, {
    headers: { "Cache-Control": "no-store" },
  });
}
