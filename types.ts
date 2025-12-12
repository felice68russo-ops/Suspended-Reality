
export interface FluidParams {
  // Ripple Params
  reflectionIntensity: number;
  refractionIndex: number;
  distortionStrength: number;
  waveHeight: number;
  rippleEffectStrength: number;
  dynamicSpeed: number;

  // Stretch/Pinch Params
  grabRadius: number;       
  stretchStiffness: number; 
  reboundElasticity: number;
  blendSoftness: number;    

  // Smear (Index Finger) Params
  smearIntensity: number;   // How strong the blur is
  smearDecayTime: number;   // How fast it fades (seconds)
  smearRadius: number;      // Brush size
  colorBleeding: number;    // How much color drags
}

export type GestureType = 'NONE' | 'PALM' | 'PINCH';

export interface HandPoint {
  gesture: GestureType;
  x: number; // 0-1 (Screen UV)
  y: number; // 0-1 (Screen UV)
  z: number; // Proximity
  // Index Finger Specifics for Smearing
  indexTip: {
    x: number;
    y: number;
    vx: number; // Velocity X
    vy: number; // Velocity Y
  };
}

export type HandData = [HandPoint, HandPoint];

export const DEFAULT_PARAMS: FluidParams = {
  // Existing
  reflectionIntensity: 1.0,
  refractionIndex: 0.2,
  distortionStrength: 0.8,
  waveHeight: 0.5,
  rippleEffectStrength: 2.0,
  dynamicSpeed: 1.5,

  // Physics Params
  grabRadius: 0.35,
  stretchStiffness: 0.6,
  reboundElasticity: 0.9,
  blendSoftness: 0.4,

  // New Smear Params
  smearIntensity: 0.8,
  smearDecayTime: 0.05, // Decay rate per frame-ish (derived from time)
  smearRadius: 0.15,
  colorBleeding: 0.6,
};
