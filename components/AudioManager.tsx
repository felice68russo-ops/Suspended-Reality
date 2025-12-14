
import React, { useEffect, useRef } from 'react';
import { HandData } from '../types';

interface AudioManagerProps {
  handDataRef: React.MutableRefObject<HandData>;
}

export const AudioManager: React.FC<AudioManagerProps> = ({ handDataRef }) => {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const isSetupRef = useRef(false);

  // --- NODES REF ---
  
  // 1. Smear (Matte Friction - Pink Noise)
  const smearGainRef = useRef<GainNode | null>(null);
  const smearFilterRef = useRef<BiquadFilterNode | null>(null);

  // 2. Pinch (Elastic Tension)
  const pinchOsc1Ref = useRef<OscillatorNode | null>(null);
  const pinchOsc2Ref = useRef<OscillatorNode | null>(null);
  const pinchGainRef = useRef<GainNode | null>(null);

  // 3. Palm (Pure Water Flow)
  const palmWaterSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const palmWaterFilterRef = useRef<BiquadFilterNode | null>(null);
  const palmWaterGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const initAudio = () => {
      if (isSetupRef.current) return;

      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new AudioContextClass() as AudioContext;
      audioCtxRef.current = ctx;

      // Master Output
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.6; 
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;

      // --- SHARED NOISE BUFFER (Pink Noise) ---
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11; 
        b6 = white * 0.115926;
      }

      // --- 1. SMEAR SYNTH ---
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = 150;

      const lpFilter = ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = 3000;

      const frictionFilter = ctx.createBiquadFilter();
      frictionFilter.type = 'bandpass';
      frictionFilter.Q.value = 0.6;
      frictionFilter.frequency.value = 400;

      const smearGain = ctx.createGain();
      smearGain.gain.value = 0;

      noiseSource.connect(hpFilter);
      hpFilter.connect(lpFilter);
      lpFilter.connect(frictionFilter);
      frictionFilter.connect(smearGain);
      smearGain.connect(masterGain);
      noiseSource.start();

      smearFilterRef.current = frictionFilter;
      smearGainRef.current = smearGain;

      // --- 2. PINCH SYNTH ---
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc2.type = 'triangle';
      
      const pinchGain = ctx.createGain();
      pinchGain.gain.value = 0;

      osc1.connect(pinchGain);
      osc2.connect(pinchGain);
      pinchGain.connect(masterGain);
      osc1.start();
      osc2.start();

      pinchOsc1Ref.current = osc1;
      pinchOsc2Ref.current = osc2;
      pinchGainRef.current = pinchGain;

      // --- 3. PALM SYNTH (Pure Water) ---
      
      // Layer A: Water Noise
      const palmNoiseSource = ctx.createBufferSource();
      palmNoiseSource.buffer = noiseBuffer; // Reuse pink noise
      palmNoiseSource.loop = true;

      const palmFilter = ctx.createBiquadFilter();
      palmFilter.type = 'lowpass'; 
      palmFilter.Q.value = 4.0; // Increased Q slightly for more "liquid" resonance
      palmFilter.frequency.value = 300; 

      const palmGain = ctx.createGain();
      palmGain.gain.value = 0;

      palmNoiseSource.connect(palmFilter);
      palmFilter.connect(palmGain);
      palmGain.connect(masterGain);
      palmNoiseSource.start();

      palmWaterSourceRef.current = palmNoiseSource;
      palmWaterFilterRef.current = palmFilter;
      palmWaterGainRef.current = palmGain;
      
      isSetupRef.current = true;
    };

    const handleInteract = () => {
      if (!isSetupRef.current) initAudio();
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    };

    window.addEventListener('click', handleInteract);
    window.addEventListener('touchstart', handleInteract);

    let animationFrameId: number;
    const loop = () => {
      if (audioCtxRef.current && isSetupRef.current) {
        updateAudio(audioCtxRef.current.currentTime);
      }
      animationFrameId = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener('click', handleInteract);
      window.removeEventListener('touchstart', handleInteract);
      cancelAnimationFrame(animationFrameId);
      audioCtxRef.current?.close();
    };
  }, []);

  const updateAudio = (now: number) => {
    const hands = handDataRef.current;
    
    // --- METRICS ---
    let maxSmearVelocity = 0;
    let maxPinchStretch = 0;
    let maxPalmProximity = 0;
    let activePinch = false;

    const RAMP_TIME = 0.05;

    hands.forEach(hand => {
      // 1. Smear
      const vel = Math.hypot(hand.indexTip.vx, hand.indexTip.vy);
      const normalizedVel = Math.min(vel / 3.0, 1.0); 
      maxSmearVelocity = Math.max(maxSmearVelocity, normalizedVel);

      // 2. Palm
      if (hand.gesture === 'PALM') {
        maxPalmProximity = Math.max(maxPalmProximity, hand.z);
      }

      // 3. Pinch
      if (hand.gesture === 'PINCH') {
        activePinch = true;
        const handVel = Math.hypot(hand.indexTip.vx, hand.indexTip.vy);
        maxPinchStretch = Math.max(maxPinchStretch, Math.min(handVel / 2.0, 1.0));
      }
    });

    // --- APPLY ---

    // 1. Smear (Matte Friction)
    if (smearGainRef.current && smearFilterRef.current) {
        const isActive = maxSmearVelocity > 0.05;
        // Volume Reduced: 0.8 -> 0.3
        const targetVol = isActive ? maxSmearVelocity * 0.3 : 0;
        const targetFreq = 300 + (maxSmearVelocity * 900);

        smearGainRef.current.gain.setTargetAtTime(targetVol, now, RAMP_TIME);
        smearFilterRef.current.frequency.setTargetAtTime(targetFreq, now, RAMP_TIME);
    }

    // 2. Pinch (Rubber Tension)
    if (pinchGainRef.current && pinchOsc1Ref.current && pinchOsc2Ref.current) {
        const targetVol = activePinch ? 0.2 : 0;
        const baseFreq = 100; 
        const targetFreq = baseFreq + (maxPinchStretch * 150); 

        pinchGainRef.current.gain.setTargetAtTime(targetVol, now, 0.05);
        pinchOsc1Ref.current.frequency.setTargetAtTime(targetFreq, now, RAMP_TIME);
        pinchOsc2Ref.current.frequency.setTargetAtTime(targetFreq * 1.02, now, RAMP_TIME); 
    }

    // 3. Palm (Pure Water Flow)
    if (palmWaterGainRef.current && palmWaterFilterRef.current) {
        const isActive = maxPalmProximity > 0.01;
        // Smoothed volume
        const targetVol = isActive ? Math.min(maxPalmProximity * 2.5, 1.0) : 0;
        
        // --- Water Logic ---
        // LFO for "flowing" texture
        const flowLFO = Math.sin(now * 2.5) * 250; 
        // Filter logic for water sound
        const waterFreq = 350 + (maxPalmProximity * 600) + flowLFO; 
        
        palmWaterGainRef.current.gain.setTargetAtTime(targetVol, now, 0.3);
        palmWaterFilterRef.current.frequency.setTargetAtTime(waterFreq, now, 0.2);
    }
  };

  return null;
};
