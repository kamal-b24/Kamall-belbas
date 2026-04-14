import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, ThinkingLevel } from "@google/genai";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, LogIn, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, googleProvider, db } from '../firebase';
import { signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { getAccessToken, QuotaExceededError } from '../auth-utils';

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

const VOICES = [
  { id: 'adhikari', voiceId: 'Puck', name: 'Prof. Adhikari', description: 'Energetic & Fast (Kathmandu style)', color: 'bg-blue-500' },
  { id: 'thapa', voiceId: 'Charon', name: 'Prof. Thapa', description: 'Deep & Authoritative (Senior)', color: 'bg-purple-500' },
  { id: 'gurung', voiceId: 'Kore', name: 'Prof. Gurung', description: 'Calm & Patient (Western style)', color: 'bg-emerald-500' },
  { id: 'shah', voiceId: 'Fenrir', name: 'Prof. Shah', description: 'Bold & Direct (Terai influence)', color: 'bg-orange-500' },
  { id: 'sharma', voiceId: 'Zephyr', name: 'Prof. Sharma', description: 'Clear & Academic (Standard)', color: 'bg-indigo-500' },
  { id: 'bhattarai', voiceId: 'Puck', name: 'Prof. Bhattarai', description: 'Traditional & Wise', color: 'bg-red-500' },
  { id: 'chaudhary', voiceId: 'Charon', name: 'Prof. Chaudhary', description: 'Fast & Dynamic (Terai style)', color: 'bg-cyan-500' },
  { id: 'shrestha', voiceId: 'Kore', name: 'Prof. Shrestha', description: 'Friendly & Local style', color: 'bg-pink-500' },
  { id: 'rai', voiceId: 'Fenrir', name: 'Prof. Rai', description: 'Enthusiastic (Eastern style)', color: 'bg-yellow-600' },
];

export default function LiveAudioSession() {
  console.log('LiveAudioSession component rendering');
  const status = document.getElementById('debug-status');
  if (status) status.innerText = 'LiveAudioSession component rendering...';
  
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showQuotaUpgrade, setShowQuotaUpgrade] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0]);
  const [showVoicePicker, setShowVoicePicker] = useState(true);
  const [currentTime, setCurrentTime] = useState("");

  const lastTapRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser) {
        // Create/Update user profile in Firestore
        await setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          lastLogin: serverTimestamp()
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      setError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Sign in failed:", err);
      setError("Sign in failed. Please try again.");
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setAccessToken(null);
  };

  useEffect(() => {
    console.log('LiveAudioSession mount effect');
    const updateTime = () => {
      try {
        const ktmTime = new Date().toLocaleTimeString('en-US', { 
          timeZone: 'Asia/Kathmandu', 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: false 
        });
        setCurrentTime(ktmTime);
      } catch (e) {
        console.error('Time format error:', e);
        setCurrentTime(new Date().toLocaleTimeString());
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    const status = document.getElementById('debug-status');
    if (status) status.innerText = 'LiveAudioSession mounted successfully!';
    return () => clearInterval(interval);
  }, []);

  const handleProfessorTap = (voice: typeof VOICES[0]) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (selectedVoice.id === voice.id && (now - lastTapRef.current) < DOUBLE_TAP_DELAY) {
      startCall();
    } else {
      setSelectedVoice(voice);
    }
    lastTapRef.current = now;
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallDuration(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;

    isPlayingRef.current = true;
    const pcmData = audioQueueRef.current.shift()!;
    
    // Convert Int16 to Float32
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / 32768.0;
    }

    const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      isPlayingRef.current = false;
      playNextInQueue();
    };

    source.start();
  }, []);

  const handleMessage = useCallback((message: LiveServerMessage) => {
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          const binaryString = atob(part.inlineData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const pcmData = new Int16Array(bytes.buffer);
          audioQueueRef.current.push(pcmData);
          playNextInQueue();
        }
      }
    }

    if (message.serverContent?.interrupted) {
      audioQueueRef.current = [];
      isPlayingRef.current = false;
    }
  }, [playNextInQueue]);

  const startCall = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // Check for microphone permission explicitly
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop()); // Stop immediately, just testing permission
      } catch (err) {
        console.error("Microphone permission denied:", err);
        throw new Error("Microphone permission denied. Please enable it in your app/browser settings.");
      }

      setShowVoicePicker(false);

      // Get OAuth token for Gemini Connect
      let token = accessToken;
      if (!token) {
        try {
          token = await getAccessToken();
          setAccessToken(token);
        } catch (err: any) {
          console.error("Failed to get access token:", err);
          // If it's a timeout or popup block, we should probably stop and let the user try again
          if (err.message.includes("timed out") || err.message.includes("blocked")) {
            throw err;
          }
          // Fallback to API key if OAuth fails for other reasons
        }
      }

      const apiKey = process.env.GEMINI_API_KEY;
      
      // Initialize AI with either accessToken (per-user quota) or apiKey (developer quota)
      const ai = new GoogleGenAI(token ? { accessToken: token } : { apiKey: apiKey! });
      
      if (!token && !apiKey) {
        throw new Error("Authentication failed. Please sign in or provide an API key.");
      }
      
      const session = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice.voiceId as any } },
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ googleSearch: {} }],
          systemInstruction: `You are 'BBS Professor ${selectedVoice.name}', an expert academic assistant for 4th-year BBS students at TU, Nepal. 
Respond INSTANTLY and concisely in a natural mix of Nepali and English (Neplish). 
Use Nepali filler words (hai, haina ta, bujhyo ni) to sound human. 
Keep answers very brief for voice. Namaste!`,
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            startTimer();
          },
          onmessage: handleMessage,
          onclose: () => {
            stopCall();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            stopCall();
          }
        }
      });

      sessionRef.current = session;

      // Setup Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMuted) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
        }

        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        
        session.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Log call start
      if (user) {
        await addDoc(collection(db, 'calls'), {
          userId: user.uid,
          professorId: selectedVoice.id,
          professorName: selectedVoice.name,
          timestamp: serverTimestamp(),
          status: 'started'
        });
      }

    } catch (err: any) {
      console.error("Failed to start call:", err);
      if (err instanceof QuotaExceededError) {
        setShowQuotaUpgrade(true);
      }
      setError(err.message || "Could not access microphone or connect to AI.");
      setIsConnecting(false);
      setShowVoicePicker(true);
    }
  };

  const stopCall = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setShowVoicePicker(true);
    stopTimer();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  useEffect(() => {
    return () => stopCall();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-0 font-sans">
      <div className="w-full max-w-md h-screen sm:h-[850px] bg-neutral-900 sm:rounded-[3rem] shadow-2xl overflow-hidden border-x border-neutral-800 relative flex flex-col">
        
        {/* Status Bar Mockup */}
        <div className="h-12 flex items-center justify-between px-8 pt-4 z-10">
          <span className="text-sm font-semibold">{currentTime}</span>
          <div className="flex gap-1.5 items-center">
            {user && (
              <button onClick={handleSignOut} className="mr-2 opacity-60 hover:opacity-100 transition-opacity">
                <LogOut size={14} />
              </button>
            )}
            <div className="w-4 h-2 bg-white/40 rounded-full" />
            <div className="w-4 h-2 bg-white/40 rounded-full" />
            <div className="w-4 h-2 bg-white rounded-full" />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {isAuthLoading ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex items-center justify-center"
            >
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </motion.div>
          ) : !user ? (
            <motion.div 
              key="login"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="flex-1 flex flex-col items-center justify-center px-10 text-center"
            >
              <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-blue-600/20">
                <Phone size={48} className="text-white" />
              </div>
              <h1 className="text-3xl font-bold mb-4">BBS Professor</h1>
              <p className="text-neutral-400 mb-10 leading-relaxed">
                Connect with expert professors for your BBS 4th-year studies. Sign in to start your voice session.
              </p>
              <button 
                onClick={handleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white text-black py-4 rounded-2xl font-bold hover:bg-neutral-200 transition-colors active:scale-95"
              >
                <LogIn size={20} />
                Sign in with Google
              </button>
              {!process.env.VITE_CLIENT_ID && (
                <p className="text-amber-500 mt-4 text-xs bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                  Warning: VITE_CLIENT_ID is not set in Secrets. Gemini Connect features will be limited.
                </p>
              )}
              {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
            </motion.div>
          ) : showVoicePicker ? (
            <motion.div 
              key="picker"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col px-6 pt-8 pb-12"
            >
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight mb-2">Contacts</h2>
                <p className="text-neutral-500 text-sm">Double-tap a Professor to start call</p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                {VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => handleProfessorTap(voice)}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-200 border ${
                      selectedVoice.id === voice.id 
                        ? 'bg-neutral-800 border-neutral-600 scale-[1.02]' 
                        : 'bg-neutral-800/40 border-transparent hover:bg-neutral-800/60'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${voice.color} text-white shadow-lg`}>
                      {voice.name.charAt(6)}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="font-bold text-lg">{voice.name}</h3>
                      <p className="text-neutral-500 text-xs">{voice.description}</p>
                    </div>
                    {selectedVoice.id === voice.id && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="call"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center pt-16 relative"
            >
              {/* Caller Info */}
              <div className="flex flex-col items-center">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`w-36 h-36 ${selectedVoice.color} rounded-full flex items-center justify-center mb-8 overflow-hidden border-4 border-white/10 shadow-2xl`}
                >
                  <span className="text-6xl font-black text-white/90">{selectedVoice.name.charAt(6)}</span>
                </motion.div>
                <h1 className="text-4xl font-bold tracking-tight">{selectedVoice.name}</h1>
                <p className="text-neutral-400 mt-3 text-lg font-medium tracking-wide">
                  {isConnected ? formatTime(callDuration) : "Connecting..."}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="absolute bottom-24 left-0 right-0 px-10">
                <div className="grid grid-cols-3 gap-6">
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    className={`flex flex-col items-center gap-3 p-5 rounded-3xl transition-all active:scale-90 ${isMuted ? 'bg-white text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                  >
                    {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
                    <span className="text-xs font-bold uppercase tracking-widest">{isMuted ? "Unmute" : "Mute"}</span>
                  </button>

                  <button 
                    onClick={stopCall}
                    className="flex flex-col items-center gap-3 p-5 bg-red-500 text-white rounded-3xl hover:bg-red-600 transition-all shadow-2xl shadow-red-500/30 active:scale-90"
                  >
                    <PhoneOff size={28} />
                    <span className="text-xs font-bold uppercase tracking-widest">End</span>
                  </button>

                  <button 
                    onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                    className={`flex flex-col items-center gap-3 p-5 rounded-3xl transition-all active:scale-90 ${!isSpeakerOn ? 'bg-white text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                  >
                    {isSpeakerOn ? <Volume2 size={28} /> : <VolumeX size={28} />}
                    <span className="text-xs font-bold uppercase tracking-widest">Speaker</span>
                  </button>
                </div>

                {error && (
                  <p className="text-red-400 text-center mt-8 text-sm font-bold bg-red-400/10 py-3 rounded-2xl border border-red-400/20">
                    {error}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quota Upgrade Notification */}
        {showQuotaUpgrade && (
          <div className="absolute inset-0 z-50 flex items-end justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              className="w-full p-[1px] rounded-3xl"
              style={{ background: 'conic-gradient(from 0deg at 50% 50%, #323336 19.35%, #4285F4 31.96%, #1AA64A 53.75%, #323336 74.94%, #FCBD00 81.08%, #DB372D 89.49%, #323336 100%)' }}
            >
              <div className="bg-neutral-900 rounded-[23px] p-6 text-left">
                <h3 className="text-white text-lg font-medium mb-2">Upgrade to continue your flow</h3>
                <p className="text-neutral-400 text-sm mb-6">
                  You’ve reached your AI usage limit for the day, you can wait for it to reset or upgrade to continue and unlock even more.
                </p>
                <div className="flex gap-3">
                  <a 
                    href="https://one.google.com/ai?utm_source=ai_studio" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1 bg-neutral-800 text-white py-3 rounded-xl text-center font-medium hover:bg-neutral-700 transition-colors"
                  >
                    Continue to upgrade
                  </a>
                  <button 
                    onClick={() => setShowQuotaUpgrade(false)}
                    className="px-6 py-3 text-neutral-400 hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Bottom Bar Indicator */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-36 h-1.5 bg-white/10 rounded-full" />
      </div>
    </div>
  );
}

