import * as React from "react";

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { results: ArrayLike<SpeechResult> };
type BrowserRecognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionConstructor = new () => BrowserRecognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

export function appendDictation(existing: string, transcript: string): string {
  const words = transcript.trim();
  if (!words) return existing;
  return existing.trimEnd() ? existing.trimEnd() + " " + words : words;
}

export function useAssistantDictation(onTranscript: (text: string) => void) {
  const [state, setState] = React.useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const instance = React.useRef<BrowserRecognition | null>(null);
  const cancelled = React.useRef(false);
  const transcript = React.useRef("");
  const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const clearTimer = () => { if (timeout.current) clearTimeout(timeout.current); timeout.current = null; };

  const start = React.useCallback(() => {
    const Speech = recognitionConstructor();
    if (!Speech) {
      setError("Dictation is unavailable in this browser. Type your message instead.");
      return;
    }
    if (instance.current) return;
    cancelled.current = false;
    transcript.current = "";
    setError(null);
    setState("starting");
    const recognizer = new Speech();
    instance.current = recognizer;
    recognizer.lang = navigator.language || "en-US";
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.onstart = () => setState("recording");
    recognizer.onresult = event => {
      let spoken = "";
      for (let index = 0; index < event.results.length; index += 1) {
        if (event.results[index]?.isFinal) spoken += " " + event.results[index][0].transcript;
      }
      transcript.current = spoken.trim();
    };
    recognizer.onerror = event => {
      cancelled.current = true;
      setError(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone permission was denied. Allow access in your browser and retry."
        : event.error === "no-speech" ? "No speech was detected. Retry or type your message."
        : event.error === "audio-capture" ? "No microphone was found. Connect one or type your message."
        : "Dictation stopped before transcription completed. Retry or type your message.");
      clearTimer();
      instance.current = null;
      setState("idle");
    };
    recognizer.onend = () => {
      clearTimer();
      instance.current = null;
      setState("idle");
      if (cancelled.current) return;
      if (transcript.current) onTranscriptRef.current(transcript.current);
      else setError("No speech was transcribed. Retry or type your message.");
    };
    try {
      recognizer.start();
      timeout.current = setTimeout(() => {
        if (instance.current === recognizer) {
          setState("transcribing");
          recognizer.stop();
        }
      }, 60_000);
    } catch {
      instance.current = null;
      setState("idle");
      setError("Could not start dictation. Check microphone access and retry.");
    }
  }, []);

  const stop = React.useCallback(() => {
    if (!instance.current) return;
    setState("transcribing");
    clearTimer();
    instance.current.stop();
  }, []);

  const cancel = React.useCallback(() => {
    cancelled.current = true;
    clearTimer();
    instance.current?.abort();
    instance.current = null;
    setState("idle");
    setError(null);
  }, []);

  React.useEffect(() => () => {
    cancelled.current = true;
    clearTimer();
    instance.current?.abort();
    instance.current = null;
  }, []);

  return { supported: Boolean(recognitionConstructor()), state, error, start, stop, cancel };
}
