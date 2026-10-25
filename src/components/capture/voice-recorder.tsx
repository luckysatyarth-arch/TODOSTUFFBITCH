'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Mic, Square, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice, SetupNotice } from '@/components/ui/feedback';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { captureAudio, transcribeCapture } from '@/app/(app)/inbox/actions';

/**
 * Browser recording and file upload.
 *
 * Audio goes straight from the browser to private storage under the user's own
 * id prefix, which is what the storage policy authorizes. It never passes
 * through a server action body, so a long recording is not bounded by the
 * request size limit.
 */
export function VoiceRecorder({
  workspaceId, userId, transcriptionAvailable,
}: {
  workspaceId: string;
  userId: string;
  transcriptionAvailable: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support recording. Upload an audio file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // webm/opus is the broadly supported recording format; the bucket's
      // allowed_mime_types list matches.
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        void upload(blob, `recording.${mime === 'audio/webm' ? 'webm' : 'ogg'}`, seconds);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone access was refused. Upload an audio file instead.');
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function upload(blob: Blob, fileName: string, durationSeconds: number) {
    setProgress('Uploading…');
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      // The path's first segment must be the user's id: that is the storage
      // policy's authorization check.
      const path = `${userId}/${crypto.randomUUID()}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('captures')
        .upload(path, blob, { contentType: blob.type, upsert: false });

      if (uploadError) {
        setProgress(null);
        setError(`Upload failed: ${uploadError.message}`);
        return;
      }

      setProgress('Registering capture…');
      const registered = await captureAudio({
        workspaceId,
        storagePath: path,
        mimeType: blob.type,
        durationSeconds,
      });

      if (!registered.ok || !registered.data) {
        setProgress(null);
        setError(registered.error ?? 'Could not register the recording.');
        return;
      }

      if (!transcriptionAvailable) {
        setProgress(
          'Saved. No transcription provider is configured, so open the capture below and ' +
            'paste the transcript to have tasks proposed.',
        );
        return;
      }

      setProgress('Transcribing and extracting…');
      startTransition(async () => {
        const result = await transcribeCapture(registered.data!.captureId);
        if (!result.ok) {
          setProgress(null);
          setError(result.error ?? 'Transcription failed.');
          return;
        }
        const count = result.data?.proposalCount ?? 0;
        setProgress(
          count === 0
            ? 'Transcribed. No action items were found.'
            : `Transcribed. ${count} proposal${count === 1 ? '' : 's'} ready for review below.`,
        );
      });
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <Button variant="danger" onClick={stop}>
            <Square />
            Stop ({mm}:{ss})
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={pending || progress !== null}>
            <Mic />
            Record a voice note
          </Button>
        )}

        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline-strong bg-paper px-3 py-1.5 text-sm text-ink hover:bg-sunken">
          <Upload className="size-4" />
          Upload audio
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file, file.name, 0);
              e.target.value = '';
            }}
          />
        </label>

        {recording ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-urgent">
            <span className="size-2 animate-pulse rounded-full bg-urgent" />
            Recording
          </span>
        ) : null}
      </div>

      {!transcriptionAvailable ? (
        <SetupNotice
          title="Transcription is not configured"
          detail={
            'Recording and upload work, but audio will not be transcribed automatically. ' +
            'Set TRANSCRIPTION_PROVIDER and OPENAI_API_KEY, or paste transcripts in by hand.'
          }
        />
      ) : null}

      {progress ? (
        <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
          {progress}
        </p>
      ) : null}
      {error ? <ErrorNotice detail={error} /> : null}
    </div>
  );
}
