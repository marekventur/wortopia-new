import Nav from "../components/Nav";
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

export default function Home() {
  return (
    <div className="container">
      <div><Nav /></div>

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
      <AccountModal />
      <RecoverModal />
      <RulesModal />
      <HighscoreModal />
    </div>
  );
}
