
import React, { useEffect, useRef } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HandData, GestureType } from '../types';

interface WebcamHandlerProps {
  onVideoReady: (video: HTMLVideoElement) => void;
  onHandUpdate: (data: HandData) => void;
  onError: (error: Error) => void;
}

export const WebcamHandler: React.FC<WebcamHandlerProps> = ({ onVideoReady, onHandUpdate, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  // Tuning Constants
  const PINCH_THRESHOLD = 0.05; 
  const PALM_OPEN_FINGER_COUNT = 5; 
  // Adjusted for better balance between responsiveness and smoothness
  const SMOOTHING_FACTOR = 0.25;
  const VELOCITY_SMOOTHING = 0.3;

  // Maintain state for up to 2 hands
  const handsStateRef = useRef<{
    [index: number]: {
      gesture: GestureType;
      smoothedPos: { x: number, y: number };
      smoothedZ: number;
      // Track index finger for velocity
      indexTipState: { x: number, y: number, vx: number, vy: number };
    }
  }>({
    0: { 
        gesture: 'NONE', 
        smoothedPos: { x: 0.5, y: 0.5 }, 
        smoothedZ: 0,
        indexTipState: { x: 0.5, y: 0.5, vx: 0, vy: 0 }
    },
    1: { 
        gesture: 'NONE', 
        smoothedPos: { x: 0.5, y: 0.5 }, 
        smoothedZ: 0,
        indexTipState: { x: 0.5, y: 0.5, vx: 0, vy: 0 }
    },
  });

  useEffect(() => {
    let isMounted = true;

    const initVision = async () => {
      if (!videoRef.current) return;
      
      // Check for browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (isMounted) onError(new Error("Camera API (getUserMedia) not supported in this browser"));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }
        });
        
        if (!isMounted) {
            // Cleanup stream if we unmounted during request
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        const video = videoRef.current;
        video.srcObject = stream;
        
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = () => {
            video.play().then(() => resolve(true)).catch(reject);
          };
          video.onerror = (e) => reject(new Error("Video load failed"));
        });
        
        if (!isMounted) return;
        
        onVideoReady(video);

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        
        if (!isMounted) return;

        handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });

        if (isMounted) startLoop();

      } catch (err) {
        console.error("Error initializing vision:", err);
        if (isMounted) {
            // Differentiate errors for better UX
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes("Permission denied") || errorMsg.includes("NotAllowedError")) {
                onError(new Error("Camera permission denied. Please allow access."));
            } else {
                onError(new Error(errorMsg));
            }
        }
      }
    };

    initVision();

    return () => {
      isMounted = false;
      cancelAnimationFrame(requestRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      handLandmarkerRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lerp = (start: number, end: number, amt: number) => {
    return (1 - amt) * start + amt * end;
  };

  const startLoop = () => {
    const detect = () => {
      if (videoRef.current && handLandmarkerRef.current) {
        const video = videoRef.current;
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          
          const results = handLandmarkerRef.current.detectForVideo(video, performance.now());
          
          const currentFrameData: HandData = [
            { gesture: 'NONE', x: 0.5, y: 0.5, z: 0, indexTip: { x: 0.5, y: 0.5, vx: 0, vy: 0 } },
            { gesture: 'NONE', x: 0.5, y: 0.5, z: 0, indexTip: { x: 0.5, y: 0.5, vx: 0, vy: 0 } }
          ];

          const foundHandsCount = results.landmarks ? results.landmarks.length : 0;

          for (let i = 0; i < 2; i++) {
             const state = handsStateRef.current[i];

             if (i < foundHandsCount) {
                const landmarks = results.landmarks[i];
                const handedness = results.handedness[i][0].categoryName; // "Left" or "Right"
                
                const wrist = landmarks[0];
                const thumbTip = landmarks[4];
                const indexTip = landmarks[8];
                const middleMcp = landmarks[9];
                
                // For Palm Orientation Check
                const indexMcp = landmarks[5];
                const pinkyMcp = landmarks[17];

                // --- GESTURE LOGIC ---
                // 1. Calculate Z (Proximity)
                const handSize = Math.sqrt(
                  Math.pow(wrist.x - middleMcp.x, 2) +
                  Math.pow(wrist.y - middleMcp.y, 2)
                );
                const rawZ = (handSize - 0.05) / 0.2;
                const targetZ = Math.max(0, Math.min(1, rawZ));

                // 2. Pinch
                const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
                const isPinching = pinchDist < PINCH_THRESHOLD;

                // 3. Open Palm
                const fingersIndices = [
                  { tip: 4, pip: 2 }, { tip: 8, pip: 6 },
                  { tip: 12, pip: 10 }, { tip: 16, pip: 14 }, { tip: 20, pip: 18 }
                ];
                let extendedFingersCount = 0;
                for (const f of fingersIndices) {
                  const tip = landmarks[f.tip];
                  const pip = landmarks[f.pip];
                  if (Math.hypot(tip.x - wrist.x, tip.y - wrist.y) > Math.hypot(pip.x - wrist.x, pip.y - wrist.y) * 1.1) {
                      extendedFingersCount++;
                  }
                }
                
                // 3.5 Check Hand Orientation
                // We use the Cross Product of (IndexMCP - Wrist) and (PinkyMCP - Wrist)
                // Vector A: Wrist -> IndexMCP
                const ax = indexMcp.x - wrist.x;
                const ay = indexMcp.y - wrist.y;
                // Vector B: Wrist -> PinkyMCP
                const bx = pinkyMcp.x - wrist.x;
                const by = pinkyMcp.y - wrist.y;
                // 2D Cross Product (Z-component)
                const crossZ = ax * by - ay * bx;

                let isBackFacingCamera = false;
                
                // Logic updated: Trigger when BACK of hand (Dorsum) is exposed.
                if (handedness === 'Left') {
                    // Left Hand Back facing: Cross Product < 0
                    isBackFacingCamera = crossZ < -0.002;
                } else {
                    // Right Hand Back facing: Cross Product > 0
                    isBackFacingCamera = crossZ > 0.002;
                }

                // Strict Condition: Fingers Open AND Back of Hand Facing Camera
                const isPalmOpen = extendedFingersCount >= PALM_OPEN_FINGER_COUNT && isBackFacingCamera;

                // 4. Update Main Pos & Gesture
                let detectedGesture: GestureType = 'NONE';
                let targetX = state.smoothedPos.x;
                let targetY = state.smoothedPos.y;

                if (isPinching) {
                  detectedGesture = 'PINCH';
                  targetX = (thumbTip.x + indexTip.x) / 2;
                  targetY = (thumbTip.y + indexTip.y) / 2;
                } else if (isPalmOpen) {
                  detectedGesture = 'PALM';
                  targetX = middleMcp.x;
                  targetY = middleMcp.y;
                } else {
                  targetX = middleMcp.x;
                  targetY = middleMcp.y;
                }

                state.gesture = detectedGesture;
                state.smoothedPos.x = lerp(state.smoothedPos.x, targetX, SMOOTHING_FACTOR);
                state.smoothedPos.y = lerp(state.smoothedPos.y, targetY, SMOOTHING_FACTOR);
                state.smoothedZ = lerp(state.smoothedZ, targetZ, 0.1); 

                // --- SMEAR LOGIC (Index Finger Velocity) ---
                // Calculate raw velocity based on last frame position
                const rawVx = indexTip.x - state.indexTipState.x;
                const rawVy = indexTip.y - state.indexTipState.y;
                
                // Update position
                state.indexTipState.x = indexTip.x;
                state.indexTipState.y = indexTip.y;
                
                // Smooth velocity (Exponential Moving Average)
                state.indexTipState.vx = lerp(state.indexTipState.vx, rawVx * 50.0, VELOCITY_SMOOTHING); // Scale up
                state.indexTipState.vy = lerp(state.indexTipState.vy, rawVy * 50.0, VELOCITY_SMOOTHING);

                currentFrameData[i] = {
                  gesture: state.gesture,
                  x: state.smoothedPos.x,
                  y: state.smoothedPos.y,
                  z: state.smoothedZ,
                  indexTip: {
                      x: state.indexTipState.x,
                      y: state.indexTipState.y,
                      vx: state.indexTipState.vx,
                      vy: state.indexTipState.vy
                  }
                };
             } else {
               // Lost hand
               state.gesture = 'NONE';
               state.smoothedZ = lerp(state.smoothedZ, 0, 0.1);
               state.indexTipState.vx = 0; 
               state.indexTipState.vy = 0;
               currentFrameData[i] = {
                  gesture: 'NONE',
                  x: state.smoothedPos.x,
                  y: state.smoothedPos.y,
                  z: state.smoothedZ,
                  indexTip: { x: state.indexTipState.x, y: state.indexTipState.y, vx: 0, vy: 0 }
               };
             }
          }
          
          onHandUpdate(currentFrameData);
        }
      }
      requestRef.current = requestAnimationFrame(detect);
    };
    detect();
  };

  return (
    <video
      ref={videoRef}
      className="hidden"
      playsInline
      muted
      autoPlay
    />
  );
};
