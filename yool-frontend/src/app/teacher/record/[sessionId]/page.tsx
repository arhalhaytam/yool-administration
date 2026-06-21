'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import type { Session } from '@/lib/types';
import { MicIcon, UserIcon, TeacherIcon, HelpCircleIcon } from '@/components/ui/Icon';
import { Mic, XCircle, CheckCircle2, StopCircle, Copy, Check } from 'lucide-react';
import styles from './page.module.css';

type TranscriptLine = {
  id: string;
  speaker_role: 'teacher' | 'participant' | 'unknown';
  text: string;
  start_ms: number;
};

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

export default function RecordingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const t = useT();
  const { locale } = useLocale();

  const [session, setSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stopping' | 'done' | 'ended' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [waveAmps, setWaveAmps] = useState<number[]>(Array(20).fill(0.3));
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // Ref mirror of autoScroll so the ws.onmessage closure always reads the latest value
  const autoScrollRef = useRef(true);

  // Animate waveform bars
  useEffect(() => {
    if (status !== 'live') return;
    const interval = setInterval(() => {
      setWaveAmps(Array(20).fill(0).map(() => 0.2 + Math.random() * 0.8));
    }, 100);
    return () => clearInterval(interval);
  }, [status]);

  // Warn before navigating away if recording
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status === 'live') {
        e.preventDefault();
        e.returnValue = ''; // Trigger the browser's default confirmation dialog
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status]);

  // Load session info
  useEffect(() => {
    api.sessions.get(sessionId)
      .then((s) => {
        setSession(s);
        if (s.status === 'done' || s.status === 'failed') {
          setStatus('ended');
        }
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(getErrorMessage(err, t('sessionDetail.sessionNotFound')));
      });
  }, [sessionId, t]);

  // Connect WebSocket + start mic
  useEffect(() => {
    if (!session) return;
    if (session.status === 'done' || session.status === 'failed') return;

    const token = getAccessToken();
    if (!token) { setStatus('error'); setErrorMsg(t('auth.sessionExpired')); return; }

    const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || 'wss://localhost')
      + `/api/stt/sessions/${sessionId}/stream?token=${token}`;

    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let isCleanedUp = false;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioCtxRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        audioSourceRef.current = source;

        // 4096 samples at e.g. 48kHz is ~85ms of audio
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
            const pcmBuffer = floatTo16BitPCM(downsampled);
            ws.send(pcmBuffer);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        setStatus('live');
        timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);

        // Setup WebSocket binary heartbeat (empty 2-byte array buffer)
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const pingBuffer = new ArrayBuffer(2);
            ws.send(pingBuffer);
          }
        }, 15000);

      } catch (err) {
        setStatus('error');
        setErrorMsg(
          getErrorMessage(
            err,
            t('record.micDenied'),
          ),
        );
      }
    };

    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pong') {
          return;
        }
        if (msg.type === 'transcript') {
          setTranscript(prev => [...prev, {
            id: crypto.randomUUID(),
            speaker_role: msg.speaker_role,
            text: msg.text,
            start_ms: msg.start_ms ?? 0,
          }]);
          if (autoScrollRef.current) {
            setTimeout(() => transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          }
        } else if (msg.type === 'topic_outline') {
          setStatus('done');
        }
      } catch {
        /* ignore malformed websocket frames */
      }
    };

    ws.onerror = () => {
      if (isCleanedUp) return;
      setStatus('error');
      setErrorMsg(t('record.wsError'));
    };
    ws.onclose = (ev) => {
      if (isCleanedUp) return;
      if (timerRef.current) clearInterval(timerRef.current);
      if (pingInterval) clearInterval(pingInterval);
      if (ev.code === 1000) return;
      setStatus((s) => {
        if (s === 'live' || s === 'connecting') {
          setErrorMsg(t('record.wsError'));
          return 'error';
        }
        return s;
      });
    };
    return () => {
      isCleanedUp = true;
      ws.close();
      if (timerRef.current) clearInterval(timerRef.current);
      if (pingInterval) clearInterval(pingInterval);
      
      // Cleanup Web Audio API nodes
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      }
      if (audioSourceRef.current) {
        audioSourceRef.current.disconnect();
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [session, sessionId, t]);

  const handleStop = useCallback(async () => {
    setStatus('stopping');
    try {
      await api.sessions.end(sessionId);
      // WS will receive the end event and close naturally
      setTimeout(() => router.push('/teacher/sessions'), 3000);
    } catch (err) {
      setStatus('error');
      setErrorMsg(getErrorMessage(err, t('common.error')));
    }
  }, [sessionId, router, t]);

  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <div className={[styles.liveDot, status === 'live' ? styles.pulsing : ''].join(' ')} />
          <span className={styles.liveLabel}>
            {status === 'connecting' ? t('record.connecting') :
             status === 'live' ? t('record.live') :
             status === 'stopping' ? t('record.processing') :
             status === 'ended' ? t('record.ended') :
             status === 'done' ? t('record.done') : t('record.error')}
          </span>
          <span className={styles.sessionName}>
            {session
              ? session.title
              : <span className={`skeleton-line ${styles.titleSkeleton}`} />}
          </span>
        </div>
        <div className={styles.timer}>{formatDuration(elapsed)}</div>
      </div>

      <div className={styles.body}>
        {/* Recording panel */}
        <div className={styles.recordPanel}>
          {status === 'connecting' && (
            <div className={styles.centerState}>
              <div className={styles.spinner} />
              <p>{t('record.connectingMic')}</p>
            </div>
          )}

          {status === 'error' && (
            <div className={styles.centerState}>
              <div className={styles.errorIcon} aria-hidden="true">
                <XCircle size={28} strokeWidth={2} />
              </div>
              <FormAlert message={errorMsg} className={styles.errorAlert} />
              <Button variant="ghost" onClick={() => router.push('/teacher')}>
                {t('record.goBack')}
              </Button>
            </div>
          )}

          {(status === 'live' || status === 'stopping') && (
            <>
              {/* Waveform */}
              <div className={styles.micWrap}>
                <div className={styles.micGlow} />
                <div className={styles.micIcon}><MicIcon size={56} color="var(--accent)" /></div>
              </div>
              <div className={styles.waveform}>
                {waveAmps.map((amp, i) => (
                  <div key={i} className={styles.waveBar}
                    style={{
                      height: `${amp * 56}px`,
                      animationDelay: `${i * 50}ms`,
                      opacity: status === 'stopping' ? 0.3 : 1,
                    }} />
                ))}
              </div>
              <p className={styles.hint}>
                {status === 'stopping' ? t('record.generatingOutline') : t('record.recordingInProgress')}
              </p>
              {status === 'live' && (
                <button className={styles.stopBtn} onClick={handleStop}>
                  <div className={styles.stopSquare} /> {t('record.stopRecording')}
                </button>
              )}
              {status === 'stopping' && (
                <div className={styles.processingPill}>
                  <div className={styles.spinner} />
                  {t('record.processingPill')}
                </div>
              )}
            </>
          )}

          {status === 'done' && (
            <div className={styles.centerState}>
              <div className={styles.doneIcon} aria-hidden="true">
                <CheckCircle2 size={28} strokeWidth={2} />
              </div>
              <p className={styles.centerHeading}>{t('record.recordingComplete')}</p>
              <p className={styles.centerSub}>{t('record.redirecting')}</p>
            </div>
          )}

          {status === 'ended' && (
            <div className={styles.centerState}>
              <div className={styles.endedIcon} aria-hidden="true">
                <StopCircle size={28} strokeWidth={2} />
              </div>
              <p className={styles.centerHeading}>{t('record.sessionEnded')}</p>
              <p className={styles.centerSub}>
                {t('record.sessionFinishedOn')} {new Date(session?.ended_at || '').toLocaleString(
                  locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
                )}.
              </p>
              <Button onClick={() => router.push(`/teacher/sessions/${sessionId}`)}>
                {t('record.viewSessionDetails')}
              </Button>
            </div>
          )}
        </div>

        {/* Live transcript */}
        <div className={styles.transcriptPanel}>
          <div className={styles.transcriptHeader}>
            <div className={styles.pulseDot} />
            <span className={styles.transcriptHeaderTitle}>{t('record.liveTranscript')}</span>
            {transcript.length > 0 && (
              <span className={styles.segCount}>
                {transcript.length} {t('session.segments')}
              </span>
            )}
            {transcript.length > 0 && (
              <button
                type="button"
                title={copied ? t('record.copied') : t('record.copyAll')}
                onClick={() => {
                  const text = transcript.map(l => `[${formatDuration(l.start_ms / 1000)}] ${l.speaker_role.toUpperCase()}: ${l.text}`).join('\n');
                  navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                className={[styles.copyBtn, copied ? styles.copyBtnDone : ''].join(' ')}
              >
                {copied
                  ? <><Check size={12} strokeWidth={2.4} /> {t('record.copied')}</>
                  : <><Copy  size={12} strokeWidth={2}  /> {t('record.copy')}</>}
              </button>
            )}
            <button
              type="button"
              title={autoScroll ? t('record.autoScrollOn') : t('record.autoScrollOff')}
              onClick={() => { setAutoScroll(v => { autoScrollRef.current = !v; return !v; }); }}
              className={[styles.autoBtn, autoScroll ? styles.autoBtnOn : ''].join(' ')}
            >
              {t('record.auto')}
            </button>
          </div>
          <div className={styles.transcriptBody}>
            {transcript.length === 0 ? (
              <EmptyState icon={Mic} title={t('record.transcriptEmpty')} />
            ) : transcript.map((line) => (
              <div key={line.id}
                className={[styles.transcriptLine, styles[`role_${line.speaker_role}`]].join(' ')}>
                <div className={styles.speakerAvatar}>
                  {line.speaker_role === 'teacher'
                    ? <TeacherIcon size={16} />
                    : line.speaker_role === 'participant'
                      ? <UserIcon size={16} />
                      : <HelpCircleIcon size={16} />}
                </div>
                <div className={styles.transcriptContent}>
                  <div className={styles.speakerMeta}>
                    <span className={styles.speakerTag}>
                      {line.speaker_role === 'teacher' ? t('record.teacher') : line.speaker_role === 'participant' ? t('record.participant') : t('record.unknown')}
                    </span>
                    <span className={styles.timeTag}>
                      {formatDuration(line.start_ms / 1000)}
                    </span>
                  </div>
                  <span className={styles.transcriptText}>{line.text}</span>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
