
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FluidParams, HandData, GestureType } from '../types';

interface FluidSceneProps {
  video: HTMLVideoElement;
  params: FluidParams;
  handDataRef: React.MutableRefObject<HandData>;
}

// --- SHADERS ---

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// 1. Smear Simulation Shader (Compute/Draw Logic)
// Writes to FBO: 
// RGB: R=DirX, G=DirY, B=Speed(Velocity Magnitude)
// A: Intensity
const smearFragmentShader = `
  uniform sampler2D uLastFrame; // Previous frame's smear
  uniform vec2 uResolution;
  
  // Hand Inputs
  uniform vec2 uIndexPos[2];
  uniform vec2 uIndexVel[2];
  
  // Params
  uniform float uDecay;
  uniform float uRadius;
  uniform float uIntensity;

  varying vec2 vUv;

  void main() {
    vec4 lastState = texture2D(uLastFrame, vUv);
    
    // --- DECAY LOGIC ---
    // Extract stored velocity magnitude from Blue channel (0.0 - 1.0)
    float storedSpeed = lastState.b;
    
    // 1. Velocity Influence: Faster strokes linger longer (momentum)
    // We reduce the decay factor as speed increases.
    // Low speed (0.0) -> Factor 1.0. High speed (1.0) -> Factor 3.0.
    float momentumFactor = 1.0 + storedSpeed * 2.0; 
    
    // 2. Calculate dynamic decay rate
    float dynamicDecay = uDecay / momentumFactor;
    
    // 3. Exponential Decay: Fades gradually based on current intensity
    // (alpha * const) is smoother than linear subtraction (alpha - const)
    float newAlpha = lastState.a * (1.0 - dynamicDecay);
    
    // Hard cutoff to prevent infinite low-alpha ghosting
    if (newAlpha < 0.005) newAlpha = 0.0;

    // Initialize new direction/speed with old state
    vec3 newDirection = lastState.rgb;

    // --- DRAWING LOGIC ---
    float totalBrush = 0.0;
    vec2 totalVel = vec2(0.0);
    float maxInputSpeed = 0.0;

    // Check both hands
    for(int i=0; i<2; i++) {
        // Fix UV coordinates (Input 0..1, flip Y)
        vec2 handPos = vec2(uIndexPos[i].x, 1.0 - uIndexPos[i].y);
        
        float dist = distance(vUv, handPos);
        
        float velMag = length(uIndexVel[i]);
        
        // Threshold: Only draw if moving fast enough to "smear"
        if(velMag > 0.02) { 
            float brush = smoothstep(uRadius, uRadius * 0.4, dist);
            if(brush > 0.0) {
                vec2 dir = normalize(uIndexVel[i]);
                totalVel += dir * brush;
                totalBrush += brush;
                maxInputSpeed = max(maxInputSpeed, velMag);
            }
        }
    }

    // Update state if brushed
    if(totalBrush > 0.0) {
        // Accumulate intensity
        newAlpha = min(1.0, newAlpha + uIntensity * totalBrush);
        
        // Encode Direction (RG)
        vec2 encodedDir = normalize(totalVel) * 0.5 + 0.5;
        
        // Encode Speed (B) - Clamp to 0..1 range
        // Typical fast swipe velocity is ~0.8 with current smoothing settings
        float encodedSpeed = clamp(maxInputSpeed, 0.0, 1.0); 
        
        vec3 targetState = vec3(encodedDir, encodedSpeed);
        
        // Mix old state with new state based on brush strength
        // We multiply brush strength to allow solid overwriting
        newDirection = mix(newDirection, targetState, min(1.0, totalBrush * 2.5));
    }

    gl_FragColor = vec4(newDirection, newAlpha);
  }
`;

// 2. Final Composite Shader
const compositeFragmentShader = `
  uniform sampler2D uTexture; // Webcam
  uniform sampler2D uSmearTexture; // The smear FBO
  
  uniform vec2 uResolution;
  uniform vec2 uTextureResolution;
  uniform float uTime;
  
  // Hand State Arrays
  uniform vec2 uHandPos[2];       
  uniform int uHandGesture[2];
  uniform float uHandZ[2];
  
  // Stretch Specifics
  uniform vec2 uStretchVector[2];
  uniform vec2 uStretchAnchor[2];
  
  // Params
  uniform float uReflectionIntensity;
  uniform float uRefractionIndex;
  uniform float uDistortionStrength;
  uniform float uWaveHeight;
  uniform float uRippleStrength;
  uniform float uSpeed;
  
  uniform float uGrabRadius;
  uniform float uBlendSoftness;
  uniform float uStretchStiffness;
  
  // Smear Params
  uniform float uSmearBleed;

  varying vec2 vUv;

  // --- NOISE ---
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  vec2 getCoverUV(vec2 screenUV, vec2 screenRes, vec2 texRes) {
    float screenAspect = screenRes.x / screenRes.y;
    float texAspect = texRes.x / texRes.y;
    vec2 ratio = vec2(
      min((screenRes.x / screenRes.y) / (texRes.x / texRes.y), 1.0),
      min((screenRes.y / screenRes.x) / (texRes.y / texRes.x), 1.0)
    );
    return vec2(
      screenUV.x * ratio.x + (1.0 - ratio.x) * 0.5,
      screenUV.y * ratio.y + (1.0 - ratio.y) * 0.5
    );
  }

  void main() {
    vec2 coverUV = getCoverUV(vUv, uResolution, uTextureResolution);
    vec2 mirrorUV = vec2(1.0 - coverUV.x, coverUV.y);
    float textureAspect = uTextureResolution.x / uTextureResolution.y;

    // --- CALCULATE GEOMETRIC DISTORTION (Ripples + Pinch) ---
    float totalHeight = 0.0;
    vec2 totalStretch = vec2(0.0);

    for(int i = 0; i < 2; i++) {
        int gesture = uHandGesture[i];
        float proximity = uHandZ[i];
        
        // Mode 1: Palm (Ripple)
        if (gesture == 1) {
            vec2 d = mirrorUV - uHandPos[i];
            d.x *= textureAspect; 
            float proxMult = 0.8 + 2.5 * proximity;
            vec2 warpedPos = d + vec2(
                snoise(vec3(d * 4.0, uTime * uSpeed + float(i) * 10.0)),
                snoise(vec3(d * 4.0 + 4.3, uTime * uSpeed + float(i) * 10.0))
            ) * 0.08 * uDistortionStrength * proxMult;
            float dist = length(warpedPos);
            float noisePhase = snoise(vec3(warpedPos * 5.0, uTime * uSpeed * 1.5));
            float ripple = sin(dist * 12.0 * uRippleStrength - uTime * uSpeed * 4.0 + noisePhase * 2.0);
            float radius = (0.35 + 0.15 * proximity); 
            float falloff = smoothstep(radius, radius - 0.25, dist);
            float core = exp(-dist * 3.5) * uDistortionStrength * 2.0 * proxMult;
            totalHeight += (ripple * 0.6 * proxMult + core) * falloff * uWaveHeight;
        }
        
        // Mode 2: Pinch (Stretch)
        vec2 stretchVec = uStretchVector[i];
        if (length(stretchVec) > 0.001) {
             vec2 d = mirrorUV - uStretchAnchor[i];
             d.x *= textureAspect;
             float dist = length(d);
             float grabMask = smoothstep(uGrabRadius + uBlendSoftness, uGrabRadius - uBlendSoftness * 0.5, dist);
             float influence = pow(grabMask, 2.0);
             totalStretch += stretchVec * influence * (1.0 - uStretchStiffness * 0.5);
             totalHeight += influence * length(stretchVec) * 2.0;
        }
    }

    float dHdx = dFdx(totalHeight) * 1.2;
    float dHdy = dFdy(totalHeight) * 1.2;
    vec2 normalDistortion = vec2(dHdx, dHdy) * 12.0 * uRefractionIndex;
    vec2 finalDistortion = normalDistortion + totalStretch;
    vec2 finalUV = mirrorUV - finalDistortion;
    
    // --- APPLY SMEAR (DIRECTIONAL BLUR) ---
    // Sample smear texture
    vec4 smear = texture2D(uSmearTexture, finalUV); 
    float smearIntensity = smear.a;
    
    vec3 finalColor;

    if (smearIntensity > 0.01) {
        // Decode direction from 0..1 back to -1..1
        vec2 smearDir = normalize(smear.rg * 2.0 - 1.0);
        
        // Directional Blur
        vec3 blurredCol = vec3(0.0);
        float totalWeight = 0.0;
        float blurScale = uSmearBleed * 0.02 * smearIntensity; // Scale blur distance
        
        // 8-tap blur along the smear direction
        for(int i=0; i<8; i++) {
            float t = float(i) / 7.0;
            // Blur backwards along the drag
            vec2 offset = -smearDir * t * blurScale; 
            
            // Add jitter for "muddy" look
            float noise = snoise(vec3(finalUV * 50.0, uTime)) * 0.002;
            offset += vec2(noise);

            blurredCol += texture2D(uTexture, finalUV + offset).rgb;
            totalWeight += 1.0;
        }
        vec3 muddyColor = blurredCol / totalWeight;
        
        // Mix clean video with muddy video based on intensity
        vec3 cleanColor = texture2D(uTexture, finalUV).rgb;
        finalColor = mix(cleanColor, muddyColor, min(1.0, smearIntensity * 1.5));
    } else {
        // Standard Chromatic Aberration if no smear
        float aberration = length(finalDistortion) * 0.03;
        float r = texture2D(uTexture, finalUV + aberration).r;
        float g = texture2D(uTexture, finalUV).g;
        float b = texture2D(uTexture, finalUV - aberration).b;
        finalColor = vec3(r, g, b);
    }

    // Highlights
    float curvature = length(vec2(dHdx, dHdy));
    float softHighlight = smoothstep(0.02, 0.25, curvature) * uReflectionIntensity;
    finalColor += vec3(0.9, 0.95, 1.0) * softHighlight;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Helper for Physics
class HandPhysics {
  anchorPoint = new THREE.Vector2(0.5, 0.5);
  currentStretch = new THREE.Vector2(0, 0);
  velocity = new THREE.Vector2(0, 0);
  isDragging = false;
  
  update(handPos: { x: number, y: number }, gesture: GestureType, params: FluidParams, dt: number) {
    const targetPos = new THREE.Vector2(handPos.x, 1.0 - handPos.y); 

    if (gesture === 'PINCH') {
      if (!this.isDragging) {
        this.isDragging = true;
        this.anchorPoint.copy(targetPos);
        this.velocity.set(0, 0);
        this.currentStretch.set(0, 0); 
      } else {
        this.currentStretch.subVectors(targetPos, this.anchorPoint);
      }
    } else {
      this.isDragging = false;
      const springK = 10.0; 
      const damping = 5.0 * (1.05 - params.reboundElasticity); 
      const force = this.currentStretch.clone().multiplyScalar(-springK);
      const dampingForce = this.velocity.clone().multiplyScalar(-damping);
      const acceleration = force.add(dampingForce);
      this.velocity.add(acceleration.multiplyScalar(dt));
      this.currentStretch.add(this.velocity.clone().multiplyScalar(dt));
      if (this.currentStretch.lengthSq() < 0.00001 && this.velocity.lengthSq() < 0.0001) {
        this.currentStretch.set(0, 0);
        this.velocity.set(0, 0);
      }
    }
  }
}

export const FluidScene: React.FC<FluidSceneProps> = ({ video, params, handDataRef }) => {
  const { gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const physicsRefs = useRef<[HandPhysics, HandPhysics]>([new HandPhysics(), new HandPhysics()]);
  
  // --- FBO SETUP FOR SMEAR ---
  const fboRead = useRef<THREE.WebGLRenderTarget | null>(null);
  const fboWrite = useRef<THREE.WebGLRenderTarget | null>(null);
  const smearScene = useRef(new THREE.Scene());
  const smearCamera = useRef(new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const smearMaterialRef = useRef<THREE.ShaderMaterial>(null);

  // Initialize FBOs
  useEffect(() => {
    const width = window.innerWidth / 2; // Half res for performance & soft blur look
    const height = window.innerHeight / 2;
    const options = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType // Important for negative velocity accumulation? Or just precision
    };
    fboRead.current = new THREE.WebGLRenderTarget(width, height, options);
    fboWrite.current = new THREE.WebGLRenderTarget(width, height, options);

    // Setup Smear Scene Quad
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: smearFragmentShader,
      uniforms: {
        uLastFrame: { value: null },
        uResolution: { value: new THREE.Vector2(width, height) },
        uIndexPos: { value: [new THREE.Vector2(0,0), new THREE.Vector2(0,0)] },
        uIndexVel: { value: [new THREE.Vector2(0,0), new THREE.Vector2(0,0)] },
        uDecay: { value: 0.01 },
        uRadius: { value: 0.1 },
        uIntensity: { value: 0.5 }
      }
    });
    smearMaterialRef.current = material;
    const mesh = new THREE.Mesh(geometry, material);
    smearScene.current.add(mesh);

    return () => {
        fboRead.current?.dispose();
        fboWrite.current?.dispose();
        geometry.dispose();
        material.dispose();
    };
  }, []);

  const videoTexture = useMemo(() => {
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }, [video]);

  // Main Scene Uniforms
  const uniforms = useMemo(() => ({
    uTexture: { value: videoTexture },
    uSmearTexture: { value: null }, // Linked in loop
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uTextureResolution: { value: new THREE.Vector2(video.videoWidth, video.videoHeight) },
    uTime: { value: 0 },
    
    // Arrays for 2 hands
    uHandPos: { value: [new THREE.Vector2(0.5, 0.5), new THREE.Vector2(0.5, 0.5)] },
    uHandGesture: { value: [0, 0] },
    uHandZ: { value: [0.0, 0.0] },
    
    uStretchVector: { value: [new THREE.Vector2(0,0), new THREE.Vector2(0,0)] },
    uStretchAnchor: { value: [new THREE.Vector2(0.5,0.5), new THREE.Vector2(0.5,0.5)] },

    // Params
    uReflectionIntensity: { value: params.reflectionIntensity },
    uRefractionIndex: { value: params.refractionIndex },
    uDistortionStrength: { value: params.distortionStrength },
    uWaveHeight: { value: params.waveHeight },
    uRippleStrength: { value: params.rippleEffectStrength },
    uSpeed: { value: params.dynamicSpeed },
    
    uGrabRadius: { value: params.grabRadius },
    uBlendSoftness: { value: params.blendSoftness },
    uStretchStiffness: { value: params.stretchStiffness },
    
    uSmearBleed: { value: params.colorBleeding },
  }), [videoTexture, params, video]);

  useFrame((state, delta) => {
    if (!meshRef.current || !fboRead.current || !fboWrite.current || !smearMaterialRef.current) return;
    
    const hands = handDataRef.current;
    const material = meshRef.current.material as THREE.ShaderMaterial;
    
    // ----------------------------
    // 1. UPDATE PHYSICS & UNIFORMS
    // ----------------------------
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    if (video.videoWidth) {
        material.uniforms.uTextureResolution.value.set(video.videoWidth, video.videoHeight);
    }
    
    // Sync Params
    material.uniforms.uReflectionIntensity.value = params.reflectionIntensity;
    material.uniforms.uRefractionIndex.value = params.refractionIndex;
    material.uniforms.uDistortionStrength.value = params.distortionStrength;
    material.uniforms.uWaveHeight.value = params.waveHeight;
    material.uniforms.uRippleStrength.value = params.rippleEffectStrength;
    material.uniforms.uSpeed.value = params.dynamicSpeed;
    material.uniforms.uGrabRadius.value = params.grabRadius;
    material.uniforms.uBlendSoftness.value = params.blendSoftness;
    material.uniforms.uStretchStiffness.value = params.stretchStiffness;
    material.uniforms.uSmearBleed.value = params.colorBleeding;

    const handPosArray = material.uniforms.uHandPos.value as THREE.Vector2[];
    const handGestureArray = material.uniforms.uHandGesture.value as number[];
    const handZArray = material.uniforms.uHandZ.value as number[];
    const stretchVecArray = material.uniforms.uStretchVector.value as THREE.Vector2[];
    const stretchAnchorArray = material.uniforms.uStretchAnchor.value as THREE.Vector2[];

    // Smear Shader Arrays
    const smearIndexPosArray = smearMaterialRef.current.uniforms.uIndexPos.value as THREE.Vector2[];
    const smearIndexVelArray = smearMaterialRef.current.uniforms.uIndexVel.value as THREE.Vector2[];

    for (let i = 0; i < 2; i++) {
        const hand = hands[i];
        const physics = physicsRefs.current[i];
        const dt = Math.min(delta, 0.1); 
        physics.update(hand, hand.gesture, params, dt);
        
        // Main Shader Updates
        handPosArray[i].set(hand.x, 1.0 - hand.y); 
        let gestureInt = 0;
        if (hand.gesture === 'PALM') gestureInt = 1;
        if (hand.gesture === 'PINCH') gestureInt = 2;
        handGestureArray[i] = gestureInt;
        handZArray[i] = hand.z;
        stretchVecArray[i].copy(physics.currentStretch);
        stretchAnchorArray[i].copy(physics.anchorPoint);

        // Smear Shader Updates (Raw values, shader handles coordinate space)
        smearIndexPosArray[i].set(hand.indexTip.x, hand.indexTip.y);
        smearIndexVelArray[i].set(hand.indexTip.vx, hand.indexTip.vy);
    }

    // ----------------------------
    // 2. RENDER SMEAR PASS (Ping-Pong)
    // ----------------------------
    smearMaterialRef.current.uniforms.uLastFrame.value = fboRead.current.texture;
    smearMaterialRef.current.uniforms.uDecay.value = params.smearDecayTime;
    smearMaterialRef.current.uniforms.uRadius.value = params.smearRadius;
    smearMaterialRef.current.uniforms.uIntensity.value = params.smearIntensity;

    gl.setRenderTarget(fboWrite.current);
    gl.render(smearScene.current, smearCamera.current);
    
    // Swap Buffers
    const temp = fboRead.current;
    fboRead.current = fboWrite.current;
    fboWrite.current = temp;

    // ----------------------------
    // 3. RENDER MAIN SCENE
    // ----------------------------
    gl.setRenderTarget(null);
    material.uniforms.uSmearTexture.value = fboRead.current.texture;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={compositeFragmentShader}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
};
