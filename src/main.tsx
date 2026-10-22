import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate";
import auraIntroVideo from "../AuraIntro.mp4?url";
import "./styles.css";
import "./auth.css";

function StartupIntro() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<"playing" | "black" | "revealing">("playing");
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase("black");
    window.setTimeout(() => setPhase("revealing"), 700);
    window.setTimeout(() => setVisible(false), 1550);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const fallback = window.setTimeout(finish, 9000);
    const attemptPlayback = async () => {
      try {
        await video.play();
      } catch {
        video.muted = true;
        setSoundEnabled(false);
        try {
          await video.play();
          setNeedsAudioTap(true);
        } catch {
          finish();
        }
      }
    };

    void attemptPlayback();
    return () => window.clearTimeout(fallback);
  }, [finish]);

  const toggleSound = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.muted) {
      try {
        video.muted = false;
        await video.play();
        setSoundEnabled(true);
        setNeedsAudioTap(false);
      } catch {
        video.muted = true;
        setSoundEnabled(false);
        setNeedsAudioTap(true);
      }
    } else {
      video.muted = true;
      setSoundEnabled(false);
      setNeedsAudioTap(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || phase !== "playing") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "m" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      event.preventDefault();
      void toggleSound();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, phase, toggleSound]);

  if (!visible) return null;

  return (
    <div className={`aura-intro-overlay aura-intro-${phase}`} role="status" aria-label="AURA AI is initializing">
      <video
        ref={videoRef}
        className={`aura-intro-video ${phase === "playing" ? "" : "aura-intro-video-hidden"}`}
        src={auraIntroVideo}
        autoPlay
        playsInline
        preload="auto"
        muted={!soundEnabled}
        onEnded={finish}
        onError={finish}
        aria-label="AURA AI startup sequence"
      />
      {needsAudioTap && (
        <button className="aura-intro-audio" type="button" onClick={() => void toggleSound()}>
          Enable sound
        </button>
      )}
      <div className="aura-intro-sound-hint" aria-live="polite">
        Press <kbd>M</kbd> to {soundEnabled ? "mute" : "enable sound"}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <AuthGate />
      <StartupIntro />
    </>
  </React.StrictMode>,
);
