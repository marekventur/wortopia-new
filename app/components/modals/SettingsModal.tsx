import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";
import { useSettingsStore, type WordListSort } from "../../stores/settingsStore";
import type { SessionUser } from "../../../lib/session.js";

type Props = {
  user: SessionUser | null;
};

async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export default function SettingsModal({ user }: Props) {
  const { closeModal } = useModalStore();
  const { showRotate, wordListSort, setSettings } = useSettingsStore();

  if (!user) return null;

  const handleShowRotateChange = async (checked: boolean) => {
    setSettings({ showRotate: checked });
    await patchSettings({ showRotate: checked });
  };

  const handleWordListSortChange = async (value: WordListSort) => {
    setSettings({ wordListSort: value });
    await patchSettings({ wordListSort: value });
  };

  return (
    <Modal id="settings" size="sm">
      <div className="modal-content">
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Einstellungen</h4>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={showRotate}
                  onChange={(e) => handleShowRotateChange(e.target.checked)}
                />
                {" "}Drehknopf anzeigen
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>Wortliste sortieren nach</label>
            <select
              className="form-control"
              value={wordListSort}
              onChange={(e) => handleWordListSortChange(e.target.value as WordListSort)}
            >
              <option value="default">Standard</option>
              <option value="alpha">Alphabetisch</option>
              <option value="points">Punkte</option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-default" onClick={closeModal}>
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}
