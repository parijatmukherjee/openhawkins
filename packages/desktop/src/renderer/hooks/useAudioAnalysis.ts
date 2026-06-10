import { useState, useEffect } from "react";

export interface AudioData {
  amplitude: number;
  isSpeaking: boolean;
}

export function useAudioAnalysis() {
  const [audioData, setAudioData] = useState<AudioData>({
    amplitude: 0.1,
    isSpeaking: false,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setAudioData((_prev: AudioData) => ({
        amplitude: Math.random() * 0.8 + 0.2,
        isSpeaking: Math.random() > 0.3,
      }));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return audioData;
}
