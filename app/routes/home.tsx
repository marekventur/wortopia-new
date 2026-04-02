import { useEffect } from "react";
import type { Route } from "./+types/home";
import Nav from "../components/Nav";
import MainAreaPositioner from "../components/MainAreaPositioner";
import { useModalStore } from "../stores/modalStore";
import CurrentField from "../components/CurrentField";
import Chat from "../components/Chat";
import PlayerList from "../components/PlayerList";
import MainNotice from "../components/MainNotice";
import GameMessages from "../components/GameMessages";
import Guesses from "../components/Guesses";
import LastField from "../components/LastField";
import OptionsModal from "../components/modals/OptionsModal";
import SignUpModal from "../components/modals/SignUpModal";
import LoginModal from "../components/modals/LoginModal";
import AccountModal from "../components/modals/AccountModal";
import RecoverModal from "../components/modals/RecoverModal";
import RulesModal from "../components/modals/RulesModal";
import HighscoreModal from "../components/modals/HighscoreModal";
import { redirect } from "react-router";
import { createGuestToken, getSession, sessionCookie, type Session } from "../../lib/session.js";
import GameProvider from "../components/GameProvider";
import type { GameSize } from "../stores/gameStore";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sizeNum = Number(params.size);
  if (sizeNum !== 4 && sizeNum !== 5) return redirect("/4");
  const size = sizeNum as GameSize;

  const url = new URL(request.url);
  const openModal = url.searchParams.get("modal");
  const session = await getSession(request);

  if (session) {
    return { session, openModal, size };
  }

  // First visit — assign a guest ID and set cookie
  const guestId = Math.floor(Math.random() * 100_001);
  const guestToken = createGuestToken(guestId);
  const cookieHeader = await sessionCookie.serialize(guestToken);

  return Response.json(
    { session: { type: "guest", guestId } as Session, openModal, size },
    { headers: { "Set-Cookie": cookieHeader } }
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { session, openModal: initialModal, size } = loaderData;
  const { openModal } = useModalStore();

  useEffect(() => {
    if (initialModal) openModal(initialModal);
  }, []);

  return (
    <GameProvider session={session} size={size}>
    <div className="container">
      <div><Nav session={session} size={size} /></div>

      <div className="row">
        {/* Small screen only: field sits above player list in normal flow */}
        <div className="col-xs-12 hidden-md hidden-lg">
          <CurrentField />
        </div>

        <MainAreaPositioner>
          <CurrentField />
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

      <OptionsModal />
      <SignUpModal />
      <LoginModal />
      <AccountModal user={session.type === "user" ? session.user : null} />
      <RecoverModal />
      <RulesModal />
      <HighscoreModal />
    </div>
    </GameProvider>
  );
}
