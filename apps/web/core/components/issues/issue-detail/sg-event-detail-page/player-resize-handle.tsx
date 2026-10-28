import { useEffect, useRef, useState } from "react";

const MIN_PLAYER_HEIGHT = 180;
const getMaxHeight = () => Math.max(MIN_PLAYER_HEIGHT, Math.min(800, window.innerHeight - 220));

export const SgEventPlayerResizeHandle = () => {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ y: number; height: number } | null>(null);
  const [height, setHeight] = useState(320);
  const [maximumHeight, setMaximumHeight] = useState(800);
  const getWorkspace = () => elementRef.current?.closest<HTMLElement>(".sg-matrix-workspace");
  const getHeight = () => getWorkspace()?.querySelector(".sg-event-player")?.getBoundingClientRect().height ?? height;
  const resize = (requestedHeight: number) => {
    const next = Math.round(Math.min(getMaxHeight(), Math.max(MIN_PLAYER_HEIGHT, requestedHeight)));
    getWorkspace()?.style.setProperty("--sg-event-player-height", `${next}px`);
    setHeight(next);
  };

  useEffect(() => {
    const measure = () => {
      setMaximumHeight(getMaxHeight());
      const currentHeight = elementRef.current
        ?.closest(".sg-matrix-workspace")
        ?.querySelector(".sg-event-player")
        ?.getBoundingClientRect().height;
      if (currentHeight) {
        const workspace = elementRef.current?.closest<HTMLElement>(".sg-matrix-workspace");
        const hasExplicitHeight = Boolean(workspace?.style.getPropertyValue("--sg-event-player-height"));
        const next = hasExplicitHeight
          ? Math.min(getMaxHeight(), Math.max(MIN_PLAYER_HEIGHT, currentHeight))
          : currentHeight;
        if (hasExplicitHeight) workspace?.style.setProperty("--sg-event-player-height", `${Math.round(next)}px`);
        setHeight(Math.round(next));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={elementRef}
      role="separator"
      tabIndex={0}
      aria-label="Resize video and staging area"
      aria-orientation="horizontal"
      aria-valuemin={MIN_PLAYER_HEIGHT}
      aria-valuemax={maximumHeight}
      aria-valuenow={height}
      title="Drag or use Up and Down arrows to resize the video and staging area"
      className="group flex h-4 w-full shrink-0 cursor-row-resize touch-none select-none items-center justify-center rounded hover:bg-custom-background-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { y: event.clientY, height: getHeight() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragRef.current) resize(dragRef.current.height + event.clientY - dragRef.current.y);
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onLostPointerCapture={() => {
        dragRef.current = null;
      }}
      onKeyDown={(event) => {
        const requested =
          event.key === "ArrowUp"
            ? getHeight() - 24
            : event.key === "ArrowDown"
              ? getHeight() + 24
              : event.key === "Home"
                ? MIN_PLAYER_HEIGHT
                : event.key === "End"
                  ? getMaxHeight()
                  : null;
        if (requested === null) return;
        event.preventDefault();
        resize(requested);
      }}
    >
      <span
        aria-hidden="true"
        className="h-1 w-12 rounded-full bg-custom-border-300 group-hover:bg-custom-primary-100"
      />
    </div>
  );
};
