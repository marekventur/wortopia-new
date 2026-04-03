import { useGameStore } from "../stores/gameStore";
import type { Route } from "./+types/home";
import Nav from "../components/Nav";
import MainAreaPositioner from "../components/MainAreaPositioner";
import CurrentField from "../components/CurrentField";
import Chat from "../components/Chat";
import PlayerList from "../components/PlayerList";
import MainNotice from "../components/MainNotice";
import GameMessages from "../components/GameMessages";
import Guesses from "../components/Guesses";
import LastField from "../components/LastField";
import { redirect } from "react-router";
import { createGuestToken, getSession, sessionCookie, type Session } from "../../lib/session.js";
import { getGameServer } from "../../lib/gameServer.js";
import GameProvider from "../components/GameProvider";
import type { GameSize } from "../stores/gameStore";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sizeNum = Number(params.size);
  if (sizeNum !== 4 && sizeNum !== 5) return redirect("/4");
  const size = sizeNum as GameSize;

  const session = await getSession(request);

  const server = getGameServer();
  const playerCounts: Record<number, number> = {};
  for (const s of [4, 5] as const) {
    const lastRound = server.getLastRound(s);
    playerCounts[s] = lastRound ? lastRound.results.players.length : 0;
  }

  if (session) {
    return { session, size, playerCounts };
  }

  // First visit — assign a guest ID and set cookie
  const guestId = Math.floor(Math.random() * 100_001);
  const guestToken = createGuestToken(guestId);
  const cookieHeader = await sessionCookie.serialize(guestToken);

  return Response.json(
    { session: { type: "guest", guestId } as Session, size, playerCounts },
    { headers: { "Set-Cookie": cookieHeader } }
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { session, size, playerCounts } = loaderData;
  const isCooldown = useGameStore((s) => s.currentRound?.state === 'cooldown');

  return (
    <GameProvider session={session} size={size}>
    <div className="container">
      <div><Nav session={session} size={size} initialPlayerCounts={playerCounts} /></div>

      <div className="row">
        {/* Small screen only: field sits above player list in normal flow */}
        {!isCooldown && (
          <div className="col-xs-12 hidden-md hidden-lg">
            <CurrentField />
          </div>
        )}

        <MainAreaPositioner>
          {!isCooldown && <CurrentField />}
          <div className="chat-wrapper"><Chat session={session} /></div>
        </MainAreaPositioner>
        <div className="col-md-3 col-md-pull-6">
          <div><PlayerList /></div>
          <div><MainNotice /></div>
        </div>
        <div className="col-md-3">
          <div><GameMessages /></div>
          <div><Guesses /></div>
          <div><LastField /></div>
        </div>
      </div>

    </div>
    </GameProvider>
  );
}
