import * as React from "react";
import { ImagePlus, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetchBlob } from "@/lib/queryClient";
import type { AssistantImageAttachment } from "@shared/assistantContracts";
import { assistantImageUrl, ASSISTANT_IMAGE_ACCEPT, type AssistantDraftImage } from "./useAssistantDraftImages";
import { appendDictation, useAssistantDictation } from "./useAssistantDictation";

function AssistantSavedImage({ conversationId, image }: { conversationId: string; image: AssistantImageAttachment }) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    let url: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    void apiFetchBlob(assistantImageUrl(conversationId, image.id), { method: "GET" })
      .then(blob => {
        url = URL.createObjectURL(blob);
        if (active) setObjectUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [conversationId, image.id]);
  if (failed) return <span className="flex h-24 w-24 items-center justify-center rounded border text-center text-xs">Image unavailable</span>;
  if (!objectUrl) return <span className="flex h-24 w-24 items-center justify-center rounded border text-xs">Loading image…</span>;
  return <a href={objectUrl} target="_blank" rel="noreferrer" aria-label={"View " + image.fileName}>
    <img src={objectUrl} alt={image.fileName} className="h-24 w-24 rounded border bg-background object-contain" />
  </a>;
}

export function AssistantImagePreviews({ conversationId, attachments }: {
  conversationId: string; attachments: readonly AssistantImageAttachment[];
}) {
  if (!attachments.length) return null;
  return <div className="mt-2 flex flex-wrap gap-2" aria-label="Attached images">
    {attachments.map(image => <AssistantSavedImage key={image.id} conversationId={conversationId} image={image} />)}
  </div>;
}

export function AssistantComposerInputs({ value, onChange, disabled, images = [], onAddImages, onRemoveImage, onRetryImage, fileError }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  images?: AssistantDraftImage[];
  onAddImages?: (files: FileList | readonly File[]) => string | null;
  onRemoveImage?: (key: string) => void;
  onRetryImage?: (key: string) => void;
  fileError?: string | null;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef(value);
  latest.current = value;
  const dictation = useAssistantDictation(text => onChange(appendDictation(latest.current, text)));
  return <>
    {images.length ? <div className="mb-2 flex max-h-32 gap-2 overflow-x-auto" aria-label="Images to send">
      {images.map(image => <div key={image.key} className="relative w-24 shrink-0 rounded border p-1 text-xs">
        <img src={image.previewUrl} alt={image.file.name} className="h-16 w-full object-contain" />
        <p className="truncate" title={image.file.name}>{image.file.name}</p>
        <p role={image.error ? "alert" : "status"} className={image.error ? "text-destructive" : "text-muted-foreground"}>
          {image.state === "uploading" ? "Uploading " + image.progress + "%" : image.error ?? (image.state === "ready" ? "Ready" : "Upload failed")}
        </p>
        {image.state === "failed" ? <Button type="button" size="sm" variant="ghost" className="h-6 px-1"
          onClick={() => onRetryImage?.(image.key)}>Retry</Button> : null}
        <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 h-6 w-6 bg-background"
          aria-label={"Remove " + image.file.name} onClick={() => onRemoveImage?.(image.key)}><X className="h-3 w-3" /></Button>
      </div>)}
    </div> : null}
    <div className="flex items-center gap-1">
      <input ref={input} type="file" multiple accept={ASSISTANT_IMAGE_ACCEPT} className="sr-only" disabled={disabled || !onAddImages}
        aria-label="Choose assistant images" onChange={event => {
          if (event.target.files) onAddImages?.(event.target.files);
          event.target.value = "";
        }} />
      <Button type="button" variant="ghost" size="icon" aria-label="Attach images" title="Attach images"
        disabled={disabled || !onAddImages || images.length >= 4} onClick={() => input.current?.click()}>
        <ImagePlus className="h-4 w-4" />
      </Button>
      {dictation.state === "recording" || dictation.state === "transcribing" || dictation.state === "starting" ? <>
        <Button type="button" variant="outline" size="icon" aria-label="Stop dictation" title="Stop dictation"
          disabled={dictation.state === "transcribing"} onClick={dictation.stop}><Square className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel dictation" title="Cancel dictation"
          onClick={dictation.cancel}><X className="h-4 w-4" /></Button>
      </> : <Button type="button" variant="ghost" size="icon" aria-label="Start dictation"
        title={dictation.supported ? "Start dictation" : "Dictation unavailable in this browser"}
        disabled={disabled || !dictation.supported} onClick={dictation.start}><Mic className="h-4 w-4" /></Button>}
      <span role="status" className="min-w-0 truncate text-xs text-muted-foreground">
        {dictation.state === "starting" ? "Starting microphone…" :
          dictation.state === "recording" ? "Listening (up to 60 seconds)…" :
          dictation.state === "transcribing" ? "Transcribing…" : ""}
      </span>
    </div>
    {dictation.error || fileError ? <p role="alert" className="text-xs text-destructive">{dictation.error || fileError}</p> : null}
  </>;
}
