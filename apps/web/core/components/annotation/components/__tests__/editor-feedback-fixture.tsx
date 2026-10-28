import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@plane/ui";

import type { TCustomPlaylistAnnotation } from "../../types/annotation.types";
import { VideoAnnotationEditor } from "../video-annotation-editor";
function Fixture() {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [properties, setProperties] = useState<HTMLDivElement | null>(null);
  const [timeline, setTimeline] = useState<HTMLDivElement | null>(null);
  const [time, setTime] = useState(0);
  const [saved, setSaved] = useState<TCustomPlaylistAnnotation[]>([]);
  const save = useRef<(() => Promise<boolean>) | null>(null);
  const register = useCallback((handler: (() => Promise<boolean>) | null) => {
    save.current = handler;
  }, []);
  return (
    <main>
      <Button unstyled type="submit" onClick={() => setTime(8)}>
        Seek to eight
      </Button>
      <Button unstyled type="submit" onClick={() => save.current?.()}>
        Save editor
      </Button>
      <div style={{ display: "flex", gap: 12 }}>
        <div ref={setToolbar} />
        <div data-testid="drawing" style={{ position: "relative", width: 700, height: 400, background: "#222" }}>
          <VideoAnnotationEditor
            annotationKey="feedback"
            annotations={saved}
            canEdit
            currentTime={time}
            durationSeconds={10}
            onSeek={setTime}
            onSave={async (annotations) => {
              setSaved(annotations);
              return annotations;
            }}
            onRegisterSaveHandler={register}
            showTimeline
            enableAnnotationTransforms
            toolbarHostElement={toolbar}
            propertyHostElement={properties}
            timelineHostElement={timeline}
          />
        </div>
        <div ref={setProperties} style={{ width: 260, height: 600 }} />
      </div>
      <div ref={setTimeline} style={{ height: 300 }} />
      <output data-testid="saved-json">{JSON.stringify(saved)}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
