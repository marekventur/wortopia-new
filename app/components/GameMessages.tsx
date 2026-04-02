import { useGameStore } from "../stores/gameStore.js";

export default function GameMessages() {
  const connected = useGameStore((s) => s.connected);

  if (connected) return null;

  return (
    <div className="alert alert-warning">
      Keine Verbindung zum Spielserver. Verbinde…
    </div>
  );
}
