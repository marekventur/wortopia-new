import { useEffect } from "react";
import type { Route } from "./+types/home";
import Nav from "../components/Nav";
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
import { createGuestToken, getSession, sessionCookie, type Session } from "../../lib/session.js";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const openModal = url.searchParams.get("modal");
  const session = await getSession(request);

  if (session) {
    return { session, openModal };
  }

  // First visit — assign a guest ID and set cookie
  const guestId = Math.floor(Math.random() * 100_001);
  const guestToken = createGuestToken(guestId);
  const cookieHeader = await sessionCookie.serialize(guestToken);

  return Response.json(
    { session: { type: "guest", guestId } as Session, openModal },
    { headers: { "Set-Cookie": cookieHeader } }
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { session, openModal: initialModal } = loaderData;
  const { openModal } = useModalStore();

  useEffect(() => {
    if (initialModal) openModal(initialModal);
  }, []);

  return (
    <div className="container">
      <div><Nav session={session} /></div>

      <div className="row">
        <div className="col-md-6 col-md-push-3 main-area">
          <div><CurrentField /></div>
          <div><Chat /></div>
        </div>
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
  );
}
