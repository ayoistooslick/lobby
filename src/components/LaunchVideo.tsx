import { useEffect, useRef } from "react";

/**
 * The launch film, rendered by the page instead of the browser's media
 * player: no controls, no PiP, no context menu — muted and looping.
 * It plays only while it is actually on screen and the tab is visible,
 * pausing otherwise so nothing runs unseen.
 */
export default function LaunchVideo() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;

    video.muted = true;

    let inView = false;
    let tabVisible = document.visibilityState !== "hidden";

    const sync = () => {
      if (inView && tabVisible) {
        void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.25 },
    );
    observer.observe(wrap);

    const onVisibility = () => {
      tabVisible = document.visibilityState !== "hidden";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
    };
  }, []);

  return (
    <div className="launch-video" ref={wrapRef}>
      <video
        ref={videoRef}
        src="/launch-video.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        controlsList="nofullscreen noplaybackrate nodownload noremoteplayback"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Lobby launch video"
      />
    </div>
  );
}
