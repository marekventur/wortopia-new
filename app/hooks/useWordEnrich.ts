import { useState, useEffect } from "react";
import { useGameStore } from "../stores/gameStore.js";
import { sendProposal } from "./sendProposal.js";

export function useWordEnrich(close: () => void) {
  const enrichResult = useGameStore((s) => s.enrichResult);
  const [enrichingWord, setEnrichingWord] = useState<string | null>(null);

  // Cancel if tooltip is dismissed before result arrives — callers should pass tooltipWord?.word
  // directly; this is signalled externally by calling cancelEnrich().

  useEffect(() => {
    if (!enrichResult || !enrichingWord || enrichResult.word !== enrichingWord) return;
    const desc = window.prompt(
      `Beschreibung für ${enrichingWord.toUpperCase()} hinzufügen:`,
      enrichResult.description ?? "",
    );
    if (desc !== null) {
      sendProposal("add", enrichingWord, desc, enrichResult.base ?? undefined);
      close();
    }
    setEnrichingWord(null);
    useGameStore.getState().setEnrichResult(null);
  }, [enrichResult]);

  const requestEnrich = (word: string) => {
    setEnrichingWord(word);
    useGameStore.getState()._send?.(JSON.stringify({ type: "enrich_word", word }));
  };

  const cancelEnrich = () => setEnrichingWord(null);

  return { enrichingWord, requestEnrich, cancelEnrich };
}
