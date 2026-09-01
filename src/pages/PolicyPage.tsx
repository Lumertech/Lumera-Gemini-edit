import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export const PolicyPage: React.FC<{ slug: string }> = ({ slug }) => {
  const [title, setTitle] = useState("Policy");
  const [body, setBody] = useState("Loading…");

  useEffect(() => {
    fetch(`/api/public/policies/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setTitle(d.title);
        setBody(d.body);
      })
      .catch(() => {
        setTitle("Not found");
        setBody("This policy page is not available.");
      });
  }, [slug]);

  return (
    <div className="min-h-screen bg-[#14061f] text-violet-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/" className="text-sm text-violet-300 hover:text-white">
          ← Back to Lumera
        </Link>
        <h1 className="text-3xl font-extrabold mt-4 mb-6">{title}</h1>
        <article className="space-y-3 text-sm leading-relaxed whitespace-pre-wrap">{body}</article>
      </div>
    </div>
  );
};
