import { useEffect, useState } from "react";
import type { Brief } from "../../shared/types";
import { Modal } from "./ui";

type ListKey = "targetUsers" | "platforms" | "keyCapabilities" | "techStack" | "constraints";
type TextKey = "name" | "oneLiner" | "problem" | "solution" | "coreValue" | "monetization" | "mvpScope";

const TEXT_FIELDS: { key: TextKey; label: string; rows: number }[] = [
  { key: "name", label: "Nama produk", rows: 1 },
  { key: "oneLiner", label: "Satu kalimat", rows: 2 },
  { key: "problem", label: "Masalah", rows: 2 },
  { key: "solution", label: "Solusi", rows: 3 },
  { key: "coreValue", label: "Nilai utama", rows: 2 },
  { key: "monetization", label: "Monetisasi", rows: 2 },
  { key: "mvpScope", label: "Lingkup MVP", rows: 3 },
];

const LIST_FIELDS: { key: ListKey; label: string }[] = [
  { key: "targetUsers", label: "Target pengguna" },
  { key: "platforms", label: "Platform" },
  { key: "techStack", label: "Tech stack" },
  { key: "keyCapabilities", label: "Kemampuan utama" },
  { key: "constraints", label: "Batasan & asumsi" },
];

export function BriefDialog({
  open,
  brief,
  onClose,
  onSave,
}: {
  open: boolean;
  brief: Brief;
  onClose: () => void;
  onSave: (brief: Brief) => Promise<void>;
}) {
  const [draft, setDraft] = useState(brief);
  const [lists, setLists] = useState<Record<ListKey, string>>(() => toLists(brief));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(brief);
      setLists(toLists(brief));
    }
  }, [open, brief]);

  const save = async () => {
    setSaving(true);
    const next: Brief = { ...draft };
    for (const f of LIST_FIELDS) {
      next[f.key] = lists[f.key]
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Brief proyek"
      title="Edit brief"
      width="max-w-3xl"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan brief"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-[13.5px] text-steel">
        Agent 3 dan agent coding membaca brief ini. Tech stack di sini menentukan teknologi yang dipakai saat task dikerjakan.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3.5">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`brief-${f.key}`}>
                {f.label}
              </label>
              {f.rows === 1 ? (
                <input
                  id={`brief-${f.key}`}
                  className="field"
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              ) : (
                <textarea
                  id={`brief-${f.key}`}
                  className="field resize-y text-[13.5px]"
                  rows={f.rows}
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <div className="space-y-3.5">
          {LIST_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`brief-${f.key}`}>
                {f.label} <span className="font-normal text-mute">(satu per baris)</span>
              </label>
              <textarea
                id={`brief-${f.key}`}
                className="field resize-y text-[13.5px]"
                rows={f.key === "keyCapabilities" ? 6 : 3}
                value={lists[f.key]}
                onChange={(e) => setLists({ ...lists, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function toLists(brief: Brief): Record<ListKey, string> {
  return {
    targetUsers: brief.targetUsers.join("\n"),
    platforms: brief.platforms.join("\n"),
    keyCapabilities: brief.keyCapabilities.join("\n"),
    techStack: brief.techStack.join("\n"),
    constraints: brief.constraints.join("\n"),
  };
}
