import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Mic, X, Send, Bot, User, Volume2, MicOff } from 'lucide-react';
import { generateChatResponse, createLiveSession, fetchResolvedAIConfig } from '../services/geminiService';

// Audio Utils for Live API
const audioContextOptions = { sampleRate: 16000 }; // Input
const outputSampleRate = 24000; // Output

function base64ToArrayBuffer(base64: string) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

interface AISupportProps {
    t: any;
    lang: 'ar' | 'en';
}

export const AISupport: React.FC<AISupportProps> = ({ t, lang }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<'TEXT' | 'VOICE'>('TEXT');
    
    // Text State
    const [messages, setMessages] = useState<{role: 'user' | 'bot', text: string}[]>([]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    // Voice State
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [liveTranscript, setLiveTranscript] = useState<{user: string, model: string}>({user: '', model: ''});
    const [voiceDisabledReason, setVoiceDisabledReason] = useState<string | null>(null);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    
    // Voice Refs
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioCtxRef = useRef<AudioContext | null>(null);
    const outputAudioCtxRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);

    // Initialize/Update Welcome Message
    useEffect(() => {
        if (messages.length === 0) {
            setMessages([{ role: 'bot', text: t.botWelcome }]);
        }
    }, [t, messages.length]);

    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        fetchResolvedAIConfig(true)
            .then((config) => {
                if (!isMounted) return;
                const provider = config?.aiProvider;
                const hasKey = Boolean(config?.apiKey);
                if (!hasKey) {
                    setVoiceDisabledReason(t.aiKeyRequired || 'API Key is required to use voice chat.');
                    return;
                }
                if (provider && provider !== 'gemini') {
                    setVoiceDisabledReason(t.voiceProviderNotSupported || 'Voice chat currently supports Gemini only.');
                    return;
                }
                setVoiceDisabledReason(null);
            })
            .catch(() => {
                if (!isMounted) return;
                setVoiceDisabledReason(t.voiceProviderNotSupported || 'Voice chat currently supports Gemini only.');
            });
        return () => {
            isMounted = false;
        };
    }, [isOpen, t]);

    // --- TEXT HANDLERS ---
    const handleSendText = async () => {
        if (!inputText.trim()) return;
        const userMsg = inputText;
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setInputText('');
        setIsTyping(true);

        const response = await generateChatResponse(
            messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: m.text })),
            userMsg,
            lang
        );

        setMessages(prev => [...prev, { role: 'bot', text: response || t.botError }]);
        setIsTyping(false);
    };

    // --- VOICE HANDLERS (LIVE API) ---
    const startVoiceSession = async () => {
        try {
            setVoiceError(null);
            if (voiceDisabledReason) {
                setVoiceError(voiceDisabledReason);
                return;
            }
            setIsConnecting(true);
            
            // 1. Setup Audio Contexts
            inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(audioContextOptions);
            outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: outputSampleRate });
            
            // 2. Connect to Live API
            sessionPromiseRef.current = createLiveSession(
                playAudioChunk,
                (text, type) => {
                    setLiveTranscript(prev => ({
                        ...prev,
                        [type]: text // Simplified: just showing latest chunk
                    }));
                },
                lang
            );

            await sessionPromiseRef.current; // Wait for connection

            // 3. Setup Mic Stream
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = inputAudioCtxRef.current.createMediaStreamSource(streamRef.current);
            processorRef.current = inputAudioCtxRef.current.createScriptProcessor(4096, 1, 1);
            
            processorRef.current.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                // Convert Float32 to PCM 16-bit
                const l = inputData.length;
                const int16 = new Int16Array(l);
                for (let i = 0; i < l; i++) {
                    int16[i] = inputData[i] * 32768;
                }
                const base64Data = arrayBufferToBase64(int16.buffer);
                
                sessionPromiseRef.current?.then(session => {
                    session.sendRealtimeInput({
                        media: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Data
                        }
                    });
                });
            };

            source.connect(processorRef.current);
            processorRef.current.connect(inputAudioCtxRef.current.destination);

            setIsConnected(true);
            setIsConnecting(false);

        } catch (err) {
            console.error("Failed to start voice", err);
            setVoiceError(t.voiceSupportError || 'Unable to start voice chat.');
            setIsConnecting(false);
        }
    };

    const stopVoiceSession = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (processorRef.current) processorRef.current.disconnect();
        if (inputAudioCtxRef.current) inputAudioCtxRef.current.close();
        if (outputAudioCtxRef.current) outputAudioCtxRef.current.close();
        
        sessionPromiseRef.current?.then(s => s.close());
        
        setIsConnected(false);
        setLiveTranscript({user: '', model: ''});
    };

    const playAudioChunk = async (base64: string) => {
        if (!outputAudioCtxRef.current) return;
        const ctx = outputAudioCtxRef.current;
        
        const arrayBuffer = base64ToArrayBuffer(base64);
        const dataInt16 = new Int16Array(arrayBuffer);
        const float32 = new Float32Array(dataInt16.length);
        for(let i=0; i<dataInt16.length; i++) {
            float32[i] = dataInt16[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, outputSampleRate);
        audioBuffer.copyToChannel(float32, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        // Schedule next chunk
        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
    };

    // Cleanup
    useEffect(() => {
        return () => stopVoiceSession();
    }, []);

    if (!isOpen) {
        return (
            <button 
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 ds-icon-container ds-icon-red p-4 rounded-full shadow-xl z-50 transition-all transform hover:scale-105"
            >
                <Bot className="h-8 w-8" />
            </button>
        );
    }

    return (
        <div 
            className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 w-auto max-w-[28rem] ds-card shadow-2xl z-50 flex flex-col overflow-hidden text-start mx-auto sm:mx-0"
            style={{ maxHeight: '90vh', height: 'min(600px, 90vh)' }}
        >
            {/* Header */}
            <div className="bg-red-900 p-4 flex justify-between items-center text-white">
                <div className="flex items-center gap-2">
                    <Bot className="h-6 w-6" />
                    <span className="ds-section-subtitle text-white">{t.aiTitle}</span>
                </div>
                <button onClick={() => setIsOpen(false)} className="hover:bg-red-500 p-1 rounded">
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-200">
                <button 
                    onClick={() => { setMode('TEXT'); stopVoiceSession(); }}
                    className={`flex-1 p-3 text-sm font-medium ${mode === 'TEXT' ? 'text-red-600 border-b-2 border-red-600' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                    <MessageSquare className="h-4 w-4 inline me-2" /> {t.textChat}
                </button>
                <button 
                    onClick={() => setMode('VOICE')}
                    disabled={Boolean(voiceDisabledReason)}
                    className={`flex-1 p-3 text-sm font-medium ${mode === 'VOICE' ? 'text-red-600 border-b-2 border-red-600' : 'text-zinc-500 hover:text-zinc-700'} ${voiceDisabledReason ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <Mic className="h-4 w-4 inline me-2" /> {t.voiceChat}
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 bg-zinc-50 overflow-y-auto p-4 flex flex-col relative">
                
                {mode === 'TEXT' ? (
                    <>
                        <div className="flex-1 space-y-4">
                            {messages.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl p-3 text-sm ${
                                        msg.role === 'user' 
                                            ? 'bg-red-900 text-white rounded-br-none rtl:rounded-bl-none rtl:rounded-br-2xl' 
                                            : 'bg-white text-zinc-800 border border-zinc-200 rounded-bl-none rtl:rounded-br-none rtl:rounded-bl-2xl shadow-sm'
                                    }`}>
                                        {msg.text}
                                    </div>
                                </div>
                            ))}
                            {isTyping && (
                                <div className="flex justify-start">
                                    <div className="bg-zinc-200 text-zinc-500 rounded-2xl p-2 px-4 text-xs animate-pulse">
                                        {t.typing}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col sm:flex-row gap-2">
                            <input 
                                type="text" 
                                value={inputText}
                                onChange={e => setInputText(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSendText()}
                                placeholder={t.typePlaceholder}
                                className="flex-1 border border-zinc-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            <button onClick={handleSendText} className="ds-btn ds-btn-primary w-full sm:w-auto flex items-center justify-center">
                                <Send className="h-5 w-5 rtl:rotate-180" />
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-8">
                        <div className="text-center space-y-2">
                            <h3 className="ds-section-subtitle">{t.voiceSupportTitle}</h3>
                            <p className="ds-description">{t.voiceSupportDesc}</p>
                            {(voiceDisabledReason || voiceError) && (
                                <p className="text-xs text-red-600">{voiceError || voiceDisabledReason}</p>
                            )}
                        </div>

                        <div className={`relative h-32 w-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                            isConnected ? 'bg-red-100' : 'bg-zinc-100'
                        }`}>
                            {isConnected && (
                                <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin opacity-30"></div>
                            )}
                            <div className={`h-24 w-24 rounded-full flex items-center justify-center shadow-lg transition-colors ${
                                isConnected ? 'bg-red-900 text-white' : 'bg-white text-zinc-400'
                            }`}>
                                {isConnected ? <Volume2 className="h-10 w-10 animate-pulse" /> : <MicOff className="h-10 w-10" />}
                            </div>
                        </div>

                        <div className="w-full bg-white p-4 rounded-xl border border-zinc-200 shadow-sm text-xs space-y-2">
                            <div className="flex gap-2">
                                <span className="font-bold text-zinc-400">{t.you}:</span>
                                <span className="text-zinc-700">{liveTranscript.user || "..."}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="font-bold text-red-400">{t.ai}:</span>
                                <span className="text-red-700">{liveTranscript.model || "..."}</span>
                            </div>
                        </div>

                        {!isConnected ? (
                            <button 
                                onClick={startVoiceSession}
                                disabled={isConnecting}
                                className="ds-btn ds-btn-primary rounded-full shadow-lg disabled:opacity-50"
                            >
                                {isConnecting ? t.connecting : t.startConversation}
                            </button>
                        ) : (
                            <button 
                                onClick={stopVoiceSession}
                                className="ds-btn ds-btn-secondary rounded-full bg-zinc-700 text-white shadow-lg hover:bg-zinc-800"
                            >
                                {t.endCall}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};