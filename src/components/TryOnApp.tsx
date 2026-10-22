"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CROP, type CropState } from "@/lib/crop";
import { ImageLoadError, canvasToBlob, loadImageFile, photoFromBlob, photoFromCanvas, releaseCanvas, releaseImage, renderCrop, type LoadedImage, type Photo } from "@/lib/image";
import { DEFAULT_LOOK, type LookSettings } from "@/lib/look";
import type { PatternDef } from "@/lib/patterns";
import { detectShirt, preloadModels } from "@/lib/segmentation";
import { clearSession, loadSession, saveSession, type SavedSession } from "@/lib/storage";
import CropScreen from "./CropScreen";
import LiveScreen from "./LiveScreen";
import MaskScreen, { type DetectState } from "./MaskScreen";
import StudioScreen from "./StudioScreen";
import UploadScreen, { type SavedPreview } from "./UploadScreen";

type Step = "upload" | "live" | "crop" | "mask" | "studio";

/** Below this share of the frame we treat detection as "no shirt found". */
const MIN_SHIRT_COVERAGE = 0.004;

export default function TryOnApp() {
  const [step, setStep] = useState<Step>("upload");
  /** Where the current photo came from, so "Back" from the mask step returns there. */
  const [origin, setOrigin] = useState<"upload" | "live">("upload");
  const [source, setSource] = useState<LoadedImage | null>(null);
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [autoMask, setAutoMask] = useState<Uint8Array | null>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [detect, setDetect] = useState<DetectState>({ status: "idle" });
  const [look, setLook] = useState<LookSettings>(DEFAULT_LOOK);
  const [customPatterns, setCustomPatterns] = useState<PatternDef[]>([]);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ session: SavedSession; preview: SavedPreview } | null>(null);
  const detectRun = useRef(0);
  const photoBlob = useRef<Blob | null>(null);

  // Offer to resume only if the user previously chose "Keep on this device".
  useEffect(() => {
    let cancelled = false;
    void loadSession().then((session) => {
      if (cancelled || !session) return;
      setSaved({ session, preview: { thumbUrl: URL.createObjectURL(session.photo), savedAt: session.savedAt } });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (saved) URL.revokeObjectURL(saved.preview.thumbUrl);
  }, [saved]);
  useEffect(() => () => releaseImage(source), [source]);
  useEffect(() => () => releaseCanvas(photo?.canvas), [photo]);

  const runDetection = useCallback(async (target: Photo) => {
    const run = ++detectRun.current;
    setDetect({ status: "running", stage: "loading-model" });
    try {
      const result = await detectShirt(target.canvas, (stage) => {
        if (run === detectRun.current) setDetect({ status: "running", stage });
      });
      if (run !== detectRun.current) return;
      if (result.coverage < MIN_SHIRT_COVERAGE) {
        setDetect({ status: "empty" });
        return;
      }
      setAutoMask(result.mask);
      setDetect({ status: "done", trousersSeparated: result.trousersSeparated });
    } catch (e) {
      if (run !== detectRun.current) return;
      console.error("Shirt detection failed", e);
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setDetect({ status: "failed", message: offline ? "you appear to be offline" : "the detector couldn't load" });
    }
  }, []);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadImageFile(file);
      setSource(loaded);
      setOrigin("upload");
      setCrop(DEFAULT_CROP);
      setStep("crop");
      preloadModels();
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : "Something went wrong opening this photo. Please try another.");
    } finally {
      setBusy(false);
    }
  };

  const onCropDone = (c: CropState) => {
    if (!source) return;
    try {
      const next = photoFromCanvas(renderCrop(source, c));
      setCrop(c);
      setPhoto(next);
      photoBlob.current = null;
      setAutoMask(null);
      setMask(null);
      setStep("mask");
      void runDetection(next);
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : "This photo couldn't be processed on this device.");
      setStep("upload");
    }
  };

  const onLiveCapture = (frame: HTMLCanvasElement, liveLook: LookSettings) => {
    try {
      const next = photoFromCanvas(frame);
      setLook(liveLook);
      setSource(null);
      setOrigin("live");
      setPhoto(next);
      photoBlob.current = null;
      setAutoMask(null);
      setMask(null);
      setStep("mask");
      void runDetection(next);
    } catch {
      setError("This frame couldn't be processed on this device.");
      setStep("upload");
    }
  };

  const persist = useCallback(
    async (p: Photo, m: Uint8Array, a: Uint8Array | null, l: LookSettings) => {
      try {
        photoBlob.current ??= await canvasToBlob(p.canvas, "image/png");
        await saveSession({ photo: photoBlob.current, width: p.width, height: p.height, mask: m, autoMask: a, look: l, savedAt: Date.now() });
      } catch (e) {
        console.warn("Could not save session", e);
      }
    },
    [],
  );

  // Keep the saved copy current while "Keep on this device" is on.
  useEffect(() => {
    if (!remember || !photo || !mask) return;
    const t = setTimeout(() => void persist(photo, mask, autoMask, look), 600);
    return () => clearTimeout(t);
  }, [remember, photo, mask, autoMask, look, persist]);

  const onRemember = (v: boolean) => {
    setRemember(v);
    if (!v) void clearSession();
  };

  const resetAll = () => {
    detectRun.current++;
    void clearSession();
    setRemember(false);
    setSaved(null);
    setSource(null);
    setPhoto(null);
    setAutoMask(null);
    setMask(null);
    setCustomPatterns([]);
    setLook(DEFAULT_LOOK);
    setDetect({ status: "idle" });
    photoBlob.current = null;
    setStep("upload");
  };

  const resume = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      const p = await photoFromBlob(saved.session.photo);
      photoBlob.current = saved.session.photo;
      setPhoto(p);
      setMask(saved.session.mask);
      setAutoMask(saved.session.autoMask);
      setLook({ ...DEFAULT_LOOK, ...saved.session.look });
      setDetect(saved.session.autoMask ? { status: "done", trousersSeparated: false } : { status: "idle" });
      setRemember(true);
      setSaved(null);
      setStep("studio");
    } catch {
      setError("The saved photo couldn't be opened. It has been removed.");
      void clearSession();
      setSaved(null);
    } finally {
      setBusy(false);
    }
  };

  if (step === "live") {
    return (
      <LiveScreen
        initialLook={look}
        customPatterns={customPatterns}
        onCustomPatterns={setCustomPatterns}
        onClose={() => setStep(photo && mask ? "studio" : "upload")}
        onCapture={onLiveCapture}
      />
    );
  }
  if (step === "crop" && source) {
    return <CropScreen image={source} initial={crop} onBack={() => setStep("upload")} onDone={onCropDone} />;
  }
  if (step === "mask" && photo) {
    return (
      <MaskScreen
        photo={photo}
        autoMask={autoMask}
        initialMask={mask}
        detect={detect}
        onRedetect={() => void runDetection(photo)}
        onBack={() => (source ? setStep("crop") : origin === "live" ? setStep("live") : resetAll())}
        onDone={(m) => {
          setMask(m);
          setStep("studio");
        }}
      />
    );
  }
  if (step === "studio" && photo && mask) {
    return (
      <StudioScreen
        photo={photo}
        mask={mask}
        initialLook={look}
        customPatterns={customPatterns}
        onCustomPatterns={setCustomPatterns}
        onLookChange={setLook}
        remember={remember}
        onRemember={onRemember}
        onEditMask={() => setStep("mask")}
        onRemovePhoto={resetAll}
      />
    );
  }
  return (
    <UploadScreen
      onFile={onFile}
      onLive={() => {
        setError(null);
        preloadModels();
        setStep("live");
      }}
      busy={busy}
      error={error}
      saved={saved?.preview ?? null}
      onResume={resume}
      onForget={() => {
        void clearSession();
        setSaved(null);
      }}
    />
  );
}
