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
import GameProvider from "../components/GameProvider";
import type { GameSize } from "../stores/gameStore";
import { getGameServer, type UpdatePayload } from "../../lib/gameServer.js";
import { getChatServer } from "../../lib/chatServer.js";
import type { ChatMessage } from "../../lib/chatTypes.js";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sizeNum = Number(params.size);
  if (sizeNum !== 4 && sizeNum !== 5) return redirect("/4");
  const size = sizeNum as GameSize;

  let session = await getSession(request);
  let cookieHeader: string | undefined;

  if (!session) {
    // First visit — assign a guest ID and set cookie
    const guestId = Math.floor(Math.random() * 100_001);
    const guestToken = createGuestToken(guestId);
    cookieHeader = await sessionCookie.serialize(guestToken);
    session = { type: "guest", guestId } as Session;
  }

  const userId = session.type === "user" ? session.user.id : -session.guestId;
  const initialGameState: UpdatePayload = getGameServer().getInitialPayload(size, userId);
  const initialChat: ChatMessage[] = getChatServer().getHistory(size);

  const payload = { session, size, initialGameState, initialChat };
  return cookieHeader
    ? Response.json(payload, { headers: { "Set-Cookie": cookieHeader } })
    : payload;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { session, size, initialGameState, initialChat } = loaderData;
  const isCooldown = useGameStore((s) => s.currentRound?.state === 'cooldown');

  return (
    <GameProvider session={session} size={size} initialGameState={initialGameState} initialChat={initialChat}>
    <div className="container">
      <div><Nav session={session} size={size} /></div>

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
