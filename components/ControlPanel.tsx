
import React from 'react';
import { FluidParams } from '../types';
import { Settings2, X, Hand } from 'lucide-react';

interface ControlPanelProps {
  params: FluidParams;
  onChange: (newParams: FluidParams) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ params, onChange }) => {
  const [isOpen, setIsOpen] = React.useState(true);

  const handleChange = (key: keyof FluidParams, value: number) => {
    onChange({ ...params, [key]: value });
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-full hover:bg-white/10 transition-colors group"
      >
        <Settings2 className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-500" />
      </button>
    );
  }

  return (
    <div className="w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-5 text-white shadow-2xl transition-all duration-300 max-h-[85vh] overflow-y-auto custom-scrollbar">
      <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold tracking-wide uppercase">System Config</h2>
        </div>
        <button 
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="w-4 h-4 text-white/60" />
        </button>
      </div>

      <div className="space-y-8">
        
        {/* Section: Smear */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] text-yellow-400 font-bold uppercase tracking-widest flex items-center gap-2">
              <Hand className="w-3 h-3" /> Smear Mode
            </h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-400/10 text-yellow-300 border border-yellow-400/20">INDEX FINGER</span>
          </div>
          
          <Slider 
            label="Smear Intensity" 
            subLabel="涂抹强度"
            value={params.smearIntensity} 
            min={0} max={2.0} step={0.1}
            onChange={(v) => handleChange('smearIntensity', v)}
          />
           <Slider 
            label="Brush Radius" 
            subLabel="笔刷半径"
            value={params.smearRadius} 
            min={0.05} max={0.4} step={0.01}
            onChange={(v) => handleChange('smearRadius', v)}
          />
          <Slider 
            label="Fade Speed" 
            subLabel="消失速度"
            value={params.smearDecayTime} 
            min={0.001} max={0.1} step={0.001}
            onChange={(v) => handleChange('smearDecayTime', v)}
          />
           <Slider 
            label="Color Bleed" 
            subLabel="颜色扩散"
            value={params.colorBleeding} 
            min={0} max={2.0} step={0.1}
            onChange={(v) => handleChange('colorBleeding', v)}
          />
        </div>
      </div>
    </div>
  );
};

const Slider: React.FC<{
  label: string;
  subLabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}> = ({ label, subLabel, value, min, max, step, onChange }) => (
  <div className="group">
    <div className="flex justify-between mb-2">
      <div className="flex items-baseline gap-2">
        <label className="text-[10px] font-medium text-white/80 uppercase tracking-wider group-hover:text-white transition-colors">
          {label}
        </label>
        {subLabel && <span className="text-[9px] text-white/40 font-light tracking-wide">{subLabel}</span>}
      </div>
      <span className="text-[10px] font-mono text-cyan-200/80 bg-white/5 px-1.5 rounded">{value.toFixed(2)}</span>
    </div>
    <div className="relative h-4 flex items-center">
        <div className="absolute w-full h-1 bg-white/10 rounded-full overflow-hidden">
             <div 
                className="h-full bg-gradient-to-r from-cyan-600 to-yellow-500 opacity-60 group-hover:opacity-100 transition-opacity" 
                style={{ width: `${((value - min) / (max - min)) * 100}%` }}
             />
        </div>
        <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="absolute w-full h-full opacity-0 cursor-pointer"
        />
        <div 
            className="absolute h-3 w-3 bg-white rounded-full shadow-lg pointer-events-none transition-all duration-75 group-hover:scale-125"
            style={{ left: `calc(${((value - min) / (max - min)) * 100}% - 6px)` }}
        />
    </div>
  </div>
);
