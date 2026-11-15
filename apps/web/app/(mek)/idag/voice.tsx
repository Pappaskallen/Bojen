"use client";

import { crm } from "@bojen/core/i18n/sv";
import { useEffect, useRef, useState } from "react";

const t = crm.day;

/** The kinds the server takes, in the order phones prefer them. */
const KINDS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

/**
 * A voice note (byggplan step 5.5d, spec M2): one big button records with the phone's
 * microphone, and the recording goes into the form's file field, so it is saved and queued
 * like a picture, also without coverage. Without a microphone, or without JavaScript, the
 * file field takes a recording from the phone's own app.
 */
export function VoiceRecorder({ inputId }: { inputId: string }) {
  const [state, setState] = useState<"idle" | "recording" | "recorded">("idle");
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices));
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const tick = setInterval(
      () => setSeconds(Math.round((Date.now() - started.current) / 1000)),
      500,
    );
    return () => clearInterval(tick);
  }, [state]);

  async function record() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!stream) return;
    const mimeType = KINDS.find((k) => MediaRecorder.isTypeSupported(k));
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = (r.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
      const ext = type === "audio/mp4" ? "m4a" : (type.split("/")[1] ?? "webm");
      const file = new File(chunks, `rost.${ext}`, { type });
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement) {
        const files = new DataTransfer();
        files.items.add(file);
        input.files = files.files;
      }
      setSeconds(Math.round((Date.now() - started.current) / 1000));
      setState("recorded");
    };
    recorder.current = r;
    started.current = Date.now();
    setSeconds(0);
    r.start();
    setState("recording");
  }

  if (!supported) return null;
  return (
    <div className="voice-recorder">
      {state === "recording" ? (
        <button type="button" className="big" onClick={() => recorder.current?.stop()}>
          {t.stopRecording} ({seconds} s)
        </button>
      ) : (
        <button type="button" className="big secondary" onClick={() => void record()}>
          {t.record}
        </button>
      )}
      <p className="help" aria-live="polite">
        {state === "recording" ? t.recording : state === "recorded" ? t.recorded(seconds) : ""}
      </p>
    </div>
  );
}
