"use client";
import { memo, useEffect, useRef, useState } from "react";

export const MicrophoneInputMeter = memo(function MicrophoneInputMeter({
  analyser,
  compact = false,
}: {
  analyser: AnalyserNode | null;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Microphone ready");
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    let raf = 0,
      lastDraw = 0,
      clippingSince = 0;
    let lastSignal = performance.now();
    let previousStatus = "";
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 50) return;
      lastDraw = now;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0,
        peak = 0;
      for (const sample of samples) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sum / samples.length);
      if (rms > 0.003) lastSignal = now;
      if (peak >= 0.98) clippingSince ||= now;
      else clippingSince = 0;
      const nextStatus =
        clippingSince && now - clippingSince > 500
          ? "Microphone input is too loud."
          : now - lastSignal > 5000
            ? "No audio detected. Check your microphone."
            : "Microphone receiving audio";
      if (nextStatus !== previousStatus) {
        previousStatus = nextStatus;
        setStatus(nextStatus);
      }
      context.clearRect(0, 0, 240, 24);
      const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(0.0001, rms)) + 60) / 60));
      for (let i = 0; i < 24; i++) {
        context.fillStyle = i / 24 <= level ? (i > 21 ? "#ef4444" : i > 18 ? "#eab308" : "#22c55e") : "#64748b40";
        context.fillRect(i * 10, 3, 7, 18);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return (
    <div className={compact ? "w-16 shrink-0" : "w-full min-w-0"}>
      <canvas
        ref={canvasRef}
        width={240}
        height={24}
        className="h-6 w-full"
        role="img"
        aria-label={analyser ? status : "Microphone is off"}
      />
      {!compact ? (
        <p role="status" className="mt-1 text-xs leading-relaxed text-custom-text-300">
          {analyser ? status : "Microphone is off"}
        </p>
      ) : null}
    </div>
  );
});
