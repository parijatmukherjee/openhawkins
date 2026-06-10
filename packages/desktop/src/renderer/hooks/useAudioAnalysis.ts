import { useState, useEffect, useRef, useCallback } from "react";

export interface AudioData {
  amplitude: number;
  isSpeaking: boolean;
}

export function useAudioAnalysis() {
  const [audioData, setAudioData] = useState<AudioData>({
    amplitude: 0.1,
    isSpeaking: false,
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const startAnalysis = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const analyze = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const amplitude = average / 255;
        const isSpeaking = amplitude > 0.15;

        setAudioData({ amplitude, isSpeaking });
        animationFrameRef.current = requestAnimationFrame(analyze);
      };

      animationFrameRef.current = requestAnimationFrame(analyze);
    } catch (_err) {
      // Fallback to mock data if microphone access denied
      const interval = setInterval(() => {
        setAudioData(() => ({
          amplitude: Math.random() * 0.3 + 0.1,
          isSpeaking: false,
        }));
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  const stopAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopAnalysis();
  }, [stopAnalysis]);

  return { audioData, startAnalysis, stopAnalysis };
}
