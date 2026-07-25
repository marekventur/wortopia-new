import { useGameStore } from "../stores/gameStore";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// The chat (which carries the cooldown timer in its input field) is hidden on
// xs/sm, so small screens get their own countdown until the next round starts.
export default function MobileCooldownTimer() {
  const secondsRemaining = useGameStore((s) => s.currentRound?.seconds_remaining ?? 0);

  return (
    <div className="pause-timer-row">
      <h2 className="pause-timer">
        Bitte warten – <span className="text-muted">{formatTime(secondsRemaining)}</span>
      </h2>
    </div>
  );
}
