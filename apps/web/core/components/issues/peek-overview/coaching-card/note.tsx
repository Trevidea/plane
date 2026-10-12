import { useMemo, useState } from "react";
import type { EditorRefApi } from "@plane/editor";
import type { TIssue } from "@plane/types";
import { Button } from "@plane/ui";
import { getTextContent } from "@plane/utils";
import { IssueDescriptionInput } from "../../description-input";
import type { TIssueOperations } from "../../issue-detail";

export const CoachingCardNote = ({
  issue,
  workspaceSlug,
  projectId,
  disabled,
  issueOperations,
  onSave,
  editorRef,
}: {
  issue: TIssue;
  workspaceSlug: string;
  projectId: string;
  disabled: boolean;
  issueOperations: TIssueOperations;
  onSave: (data: { feedback: string }) => Promise<void>;
  editorRef: React.RefObject<EditorRefApi>;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(issue.description_html || "<p></p>");
  const [error, setError] = useState(false);
  // The native editor's debounce updates the local draft. Only Save persists it.
  const draftOperations = useMemo(() => ({ ...issueOperations, update: async () => {} }), [issueOperations]);
  const save = async () => {
    setSaving(true);
    setError(false);
    try {
      await onSave({ feedback: getTextContent(draft) });
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="Coaching note" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-custom-text-100">Coaching note</h3>
        {!disabled && !editing && (
          <Button
            variant="link-primary"
            size="sm"
            onClick={() => {
              setDraft(issue.description_html || "<p></p>");
              setError(false);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      <div
        aria-busy={saving}
        className={saving ? "pointer-events-none" : undefined}
        onBeforeInputCapture={(event) => {
          if (saving) event.preventDefault();
        }}
        onKeyDownCapture={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <IssueDescriptionInput
          key={editing ? "edit" : "view"}
          editorRef={editorRef}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issue.id}
          initialValue={issue.description_html || "<p></p>"}
          disabled={!editing || disabled}
          issueOperations={draftOperations}
          setIsSubmitting={() => {}}
          onDescriptionChange={setDraft}
          placeholder="Add a coaching instruction…"
          containerClassName="-ml-3 border-none"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-custom-text-200">
          Unable to save the note. Your changes are still here.
        </p>
      )}
      {editing && (
        <div className="flex justify-end gap-2">
          <Button variant="neutral-primary" size="sm" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      )}
    </section>
  );
};
