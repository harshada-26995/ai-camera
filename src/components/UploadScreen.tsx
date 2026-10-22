"use client";

import { useEffect, useRef, useState } from "react";
import { IconCamera, IconLock, IconTrash, IconUpload } from "./icons";
import { Button, Spinner, TopBar, cx } from "./ui";
import { ACCEPTED_TYPES } from "@/lib/image";

export interface SavedPreview {
  thumbUrl: string;
  savedAt: number;
}

export default function UploadScreen({
  onFile,
  onLive,
  busy,
  error,
  saved,
  onResume,
  onForget,
}: {
  onFile: (file: File) => void;
  onLive: () => void;
  busy: boolean;
  error: string | null;
  saved: SavedPreview | null;
  onResume: () => void;
  onForget: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // Accept a dropped photo anywhere on the page.
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar step={0} />
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-10 px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-16 md:px-10 md:pt-12">
        <section className="rise">
          <p className="tag text-muted">The private fitting room</p>
          <h1 className="mt-4 font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-[3.6rem]">
            One photo.
            <br />
            <em className="font-normal">Every shirt</em> he could wear.
          </h1>
          <p className="mt-5 max-w-md text-[1rem] leading-relaxed text-ink-soft">
            Upload a photo of your father once. We find his shirt, then you flip through colours and prints instantly — the
            same photo, his face untouched.
          </p>
          <ul className="mt-8 hidden max-w-md grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid">
            {[
              ["01", "Upload & frame"],
              ["02", "Confirm the shirt"],
              ["03", "Try every print"],
            ].map(([n, t]) => (
              <li key={n} className="bg-paper p-4">
                <span className="font-display text-lg italic">{n}</span>
                <p className="mt-1 text-[0.8125rem] text-ink-soft">{t}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rise flex flex-col gap-4" style={{ animationDelay: "120ms" }}>
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a photo or drop one here"
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) pick(e.dataTransfer.files);
            }}
            className={cx(
              "group relative flex aspect-[4/5] max-h-[46dvh] md:max-h-[62dvh] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[28px] border bg-paper text-center transition-[border-color,transform] duration-300 sm:aspect-[5/5]",
              dragging ? "scale-[0.99] border-ink" : "border-line hover:border-line-strong",
            )}
          >
            {/* Tailor's chalk outline of a shirt */}
            <svg viewBox="0 0 200 220" className="absolute inset-x-0 top-[12%] mx-auto h-[46%] text-line-strong" aria-hidden="true">
              <path
                d="M70 20 22 44l14 46 18-8v118h92V82l18 8 14-46-48-24c0 14-14 26-30 26S70 34 70 20Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeDasharray="5 5"
              />
              <path d="M100 46v154" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
            </svg>
            <div className="relative mt-[42%] flex flex-col items-center px-6">
              {busy ? (
                <span className="flex items-center gap-2 text-ink-soft">
                  <Spinner /> Opening photo…
                </span>
              ) : (
                <>
                  <span className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-[0.9375rem] font-medium text-paper transition-transform duration-200 group-hover:-translate-y-0.5">
                    <IconUpload size={18} /> Choose a photo
                  </span>
                  <span className="mt-3 text-[0.8125rem] text-muted">
                    <span className="hidden sm:inline">or drop it here · </span>JPG, PNG or HEIC
                  </span>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <button
            type="button"
            onClick={onLive}
            disabled={busy}
            className="group order-first flex items-center gap-4 rounded-[22px] border border-line bg-paper p-4 text-left transition-colors hover:border-ink disabled:opacity-40 md:order-none"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
              <IconCamera size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-medium">Try live with the camera</span>
              <span className="block text-[0.8125rem] leading-snug text-muted">
                Point your phone at him and switch shirts on the live video, like a filter.
              </span>
            </span>
            <span className="text-xl text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">
              →
            </span>
          </button>

          {error && (
            <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-[0.875rem] text-danger">
              {error}
            </p>
          )}

          {saved && !busy && (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
              <img src={saved.thumbUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">Continue with your saved photo</p>
                <p className="text-[0.75rem] text-muted">Kept on this device · {new Date(saved.savedAt).toLocaleDateString()}</p>
              </div>
              <Button variant="secondary" className="h-10 px-4" onClick={onResume}>
                Open
              </Button>
              <button
                type="button"
                aria-label="Delete saved photo"
                title="Delete saved photo"
                onClick={onForget}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sand hover:text-danger"
              >
                <IconTrash size={18} />
              </button>
            </div>
          )}

          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted">
            <IconLock size={16} className="mt-0.5 shrink-0" />
            Your photo and camera never leave this device. Shirt detection runs inside your browser; nothing is recorded or
            uploaded, and no account is needed.
          </p>
        </section>
      </main>
    </div>
  );
}
