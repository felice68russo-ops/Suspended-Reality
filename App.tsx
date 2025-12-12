
import React, { useState, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { DEFAULT_PARAMS, HandData } from './types';
import { FluidScene } from './components/FluidScene';
import { WebcamHandler } from './components/WebcamHandler';
import { AudioManager } from './components/AudioManager';
import { Loader2, AlertTriangle } from 'lucide-react';

const App: React.FC = () => {
  // Removed setParams as there are no longer controls to change them
  const [params] = useState(DEFAULT_PARAMS);
  
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize with two inactive hands
  const handDataRef = useRef<HandData>([
    { 
      gesture: 'NONE', 
      x: 0.5, y: 0.5, z: 0, 
      indexTip: { x: 0.5, y: 0.5, vx: 0, vy: 0 } 
    },
    { 
      gesture: 'NONE', 
      x: 0.5, y: 0.5, z: 0,
      indexTip: { x: 0.5, y: 0.5, vx: 0, vy: 0 }
    }
  ]);

  if (error) {
    return (
      <div className="relative w-full h-screen bg-black flex items-center justify-center p-6 overflow-hidden">
        {/* Background Ambient Effect */}
        <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-black pointer-events-none" />
        
        <div className="relative bg-zinc-900/90 backdrop-blur-xl border border-red-500/20 p-8 rounded-2xl max-w-md w-full text-center shadow-2xl">
           <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-red-500/20">
             <AlertTriangle className="w-8 h-8 text-red-500" />
           </div>
           
           <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Camera Access Denied</h2>
           
           <div className="bg-black/40 rounded-lg p-4 mb-6 border border-white/5">
             <p className="text-red-200/80 text-sm font-mono">{error}</p>
           </div>
           
           <p className="text-zinc-400 text-sm leading-relaxed mb-6">
             This application requires camera access to track your hand gestures. 
             Please check your browser permissions icon in the address bar and allow camera access.
           </p>

           <button 
             onClick={() => window.location.reload()}
             className="bg-white text-black hover:bg-zinc-200 px-6 py-2 rounded-full text-sm font-medium transition-colors"
           >
             Reload Page
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      
      {/* Audio Engine (Headless) */}
      <AudioManager handDataRef={handDataRef} />

      {/* 3D Scene Layer */}
      <div className="absolute inset-0 z-10">
        {videoElement && (
          <Canvas dpr={[1, 2]} gl={{ antialias: false, alpha: false }}>
            <Suspense fallback={null}>
              <FluidScene 
                video={videoElement} 
                params={params} 
                handDataRef={handDataRef} 
              />
            </Suspense>
          </Canvas>
        )}
      </div>

      {/* Logic Layer */}
      <WebcamHandler 
        onVideoReady={(video) => {
          setVideoElement(video);
          setIsLoading(false);
        }}
        onHandUpdate={(data) => {
          handDataRef.current = data;
        }}
        onError={(err) => {
          console.error(err);
          setIsLoading(false);
          setError(err.message || "Failed to access camera");
        }}
      />

      {/* UI Layer */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-20">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 bg-black/80 backdrop-blur-sm z-30">
            <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
            <p className="text-cyan-200 text-sm tracking-widest uppercase">Initializing Vision System...</p>
          </div>
        )}
        
        {/* Title and Controls - Always Visible */}
        <div className="absolute top-6 left-6 pointer-events-auto flex flex-col gap-6 z-40">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tighter mix-blend-difference">
              Suspended <span className="text-cyan-400">Reality</span>
            </h1>
            <div className="text-xs text-white/60 mt-2 max-w-[200px] space-y-1">
                <p><span className="text-cyan-400 font-bold">MODE 1:</span> 五指张开 (Palm)</p>
                <p><span className="text-purple-400 font-bold">MODE 2:</span> 捏合拖拽 (Pinch)</p>
                <p><span className="text-yellow-400 font-bold">MODE 3:</span> 食指涂抹 (Smear)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
