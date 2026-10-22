import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate";
import auraIntroVideo from "../AuraIntro.mp4?url";
import "./styles.css";
import "./auth.css";

function StartupIntro() {
  const [visible, setVisible] = useState(true);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setVisible(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Keep the existing app mounted underneath the intro. If media fails, fail open.
    const fallback = window.setTimeout(finish, 9000);
    const attemptPlayback = async () => {
      try {
        await video.play();
      } catch {
        // Browsers may block autoplay with audio; try muted playback and offer sound on demand.
        video.muted = true;
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

  const enableAudio = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = false;
      await video.play();
      setNeedsAudioTap(false);
    } catch {
      video.muted = true;
    }
  };

  if (!visible) return null;

  return (
    <div className="aura-intro-overlay" role="status" aria-label="AURA AI is initializing">
      <video
        ref={videoRef}
        className="aura-intro-video"
        src={auraIntroVideo}
        autoPlay
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
        aria-label="AURA AI startup sequence"
      />
      {needsAudioTap && (
        <button className="aura-intro-audio" type="button" onClick={() => void enableAudio()}>
          Enable sound
        </button>
      )}
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
