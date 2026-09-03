import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

interface MediaItem {
  id: string;
  filename: string;
  url: string;
  alt: string;
  created_at: string;
}

export const AdminMedia: React.FC = () => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = () =>
    apiFetch<{ media: MediaItem[] }>("/api/media")
      .then((d) => setItems(d.media))
      .catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    body.append("alt", alt);
    await apiFetch("/api/media", { method: "POST", body });
    setFile(null);
    setAlt("");
    load();
  };

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-extrabold">Media library</h1>
      <form onSubmit={upload} className="bg-white border rounded-xl p-4 flex flex-wrap gap-2 items-end text-xs">
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <input className="border rounded px-2 py-1.5" placeholder="Alt text" value={alt} onChange={(e) => setAlt(e.target.value)} />
        <button className="bg-purple-600 text-white px-3 py-1.5 rounded font-semibold">Upload</button>
      </form>
      <div className="grid sm:grid-cols-3 gap-3">
        {items.map((m) => (
          <div key={m.id} className="bg-white border rounded-xl overflow-hidden text-xs">
            <img src={m.url} alt={m.alt} className="w-full h-32 object-cover bg-slate-100" />
            <div className="p-3 space-y-1">
              <div className="font-semibold truncate">{m.filename}</div>
              <button
                className="text-blue-600"
                onClick={() => navigator.clipboard.writeText(m.url)}
              >
                Copy URL
              </button>
              <button
                className="text-red-600 ml-2"
                onClick={async () => {
                  await apiFetch(`/api/media/${m.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
