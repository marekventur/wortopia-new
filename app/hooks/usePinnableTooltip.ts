import React, { useState, useRef, useEffect, type ReactNode } from "react";
import { Tooltip } from "react-tooltip";
import type { TooltipRefProps } from "react-tooltip";
import { useGameStore } from "../stores/gameStore.js";
import { sendProposal } from "./sendProposal.js";

export type { Tooltip, TooltipRefProps };

let instanceCounter = 0;

export function usePinnableTooltip<T extends { word: string; description: string | null }>() {
  const instanceId = useRef(++instanceCounter).current;
  const [tooltipWord, setTooltipWord] = useState<T | null>(null);
  const [tooltipPinned, setTooltipPinned] = useState(false);
  const tooltipRef = useRef<TooltipRefProps | null>(null);
  const pinnedTooltipId = useGameStore((s) => s.pinnedTooltipId);
  const myUserId = useGameStore((s) => s.myUserId);
  const proposedWords = useGameStore((s) => s.proposedWords);
  const enrichResult = useGameStore((s) => s.enrichResult);
  const isLoggedIn = myUserId !== null && myUserId > 0;
  const [enrichingWord, setEnrichingWord] = useState<string | null>(null);

  // Close when another instance pins
  useEffect(() => {
    if (pinnedTooltipId !== null && pinnedTooltipId !== instanceId) {
      tooltipRef.current?.close();
      setTooltipWord(null);
      setTooltipPinned(false);
    }
  }, [pinnedTooltipId]);

  // Close on outside click when pinned
  useEffect(() => {
    if (!tooltipPinned) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest(".word") && !t.closest(".react-tooltip")) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tooltipPinned]);

  // Cancel enriching if tooltip dismissed before result arrives
  useEffect(() => {
    if (!tooltipWord && enrichingWord) setEnrichingWord(null);
  }, [tooltipWord]);

  // Show prompt when enrich result arrives
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

  const close = () => {
    tooltipRef.current?.close();
    setTooltipWord(null);
    setTooltipPinned(false);
    if (useGameStore.getState().pinnedTooltipId === instanceId) {
      useGameStore.getState().setPinnedTooltipId(null);
    }
  };

  const handleMouseEnter = (anchorId: string, word: T) => {
    if (!tooltipPinned && word.description) {
      setTooltipWord(word);
      tooltipRef.current?.open({ anchorSelect: `#${anchorId}` });
    }
  };

  const handleMouseLeave = () => {
    if (!tooltipPinned) {
      tooltipRef.current?.close();
      setTooltipWord(null);
    }
  };

  const handleClick = (anchorId: string, word: T) => {
    if (!isLoggedIn) return;
    if (tooltipPinned && tooltipWord?.word === word.word) {
      close();
      return;
    }
    setTooltipWord(word);
    setTooltipPinned(true);
    tooltipRef.current?.open({ anchorSelect: `#${anchorId}` });
    useGameStore.getState().setPinnedTooltipId(instanceId);
  };

  const requestEnrich = (word: string) => {
    setEnrichingWord(word);
    useGameStore.getState()._send?.(JSON.stringify({ type: "enrich_word", word }));
  };

  const renderTooltip = (content: (word: T) => ReactNode): React.ReactElement =>
    React.createElement(Tooltip, {
      ref: tooltipRef,
      className: "word-tooltip",
      clickable: true,
      opacity: tooltipPinned ? 1 : 0.85,
      style: { maxWidth: 300, fontSize: 13 },
      isOpen: tooltipPinned || tooltipWord !== null,
      render: () => (tooltipWord ? content(tooltipWord) : null),
    });

  return {
    tooltipWord, tooltipPinned, tooltipRef,
    isLoggedIn, proposedWords, enrichingWord,
    handleMouseEnter, handleMouseLeave, handleClick,
    close, requestEnrich, renderTooltip,
  };
}
