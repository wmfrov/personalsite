import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { CycleState, computeCycle, easeOutCubic } from '../lib/trainingCycle';
import { useCycleStore } from '../contexts/TrainingCycleContext';

interface LossProps {
  seedData: SeedData;
  palette: Palette;
}

const WINDOW = 96;
const Y_MIN = 0;
const Y_MAX = 1;

// Loss base level peaks at the start of disperse, climbs through the
// disperse phase, then descends through converge with an ease-out, and
// settles low through hold. Reads as: model just lost a bunch of
// information at the epoch boundary, learns it back, and stabilizes.
const LOSS_PEAK = 0.95;
const LOSS_FLOOR = 0.18;

function targetTrainLoss(cycle: CycleState): number {
  if (cycle.phase === 'disperse') {
    return LOSS_FLOOR + (LOSS_PEAK - LOSS_FLOOR) * easeOutCubic(cycle.phaseProgress);
  }
  if (cycle.phase === 'converge') {
    return LOSS_PEAK + (LOSS_FLOOR - LOSS_PEAK) * easeOutCubic(cycle.phaseProgress);
  }
  return LOSS_FLOOR - 0.02 * easeOutCubic(cycle.phaseProgress);
}

export function Loss({ seedData, palette }: LossProps) {
  const [values, setValues] = useState<number[]>([]);
  const [valValues, setValValues] = useState<number[]>([]);
  const [step, setStep] = useState<number>(0);
  const animPrngRef = useRef<SeededPrng | null>(null);
  const levelRef = useRef(LOSS_FLOOR);
  const valLevelRef = useRef(LOSS_FLOOR + 0.06);
  const stepRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const cycleStore = useCycleStore();

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.LossInit);
    animPrngRef.current = derivePrng(seedData, PanelSlot.LossAnim);
    stepRef.current = 0;

    // Pre-fill the window from the *initial* cycle so the panel mounts
    // with a coherent slope into the current state instead of a flat
    // baseline.
    let lvl = LOSS_FLOOR;
    let valLvl = LOSS_FLOOR + 0.06;
    const init: number[] = [];
    const valInit: number[] = [];
    const startCycle = computeCycle(0);
    for (let i = 0; i < WINDOW; i++) {
      lvl = nextLevel(lvl, startCycle, initPrng);
      valLvl = nextValLevel(valLvl, lvl, initPrng);
      init.push(lvl);
      valInit.push(valLvl);
    }
    levelRef.current = lvl;
    valLevelRef.current = valLvl;
    setValues(init);
    setValValues(valInit);
    setStep(WINDOW);
    stepRef.current = WINDOW;
  }, [seedData]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Closure helper so live tick reads the freshest valValues without
  // re-subscribing the interval.
  const valValuesStateRef = useRef<number[]>([]);
  useEffect(() => {
    valValuesStateRef.current = valValues;
  }, [valValues]);

  // Phase-offset interval to keep panels out of lockstep.
  useEffect(() => {
    if (values.length === 0) return;
    const prng = animPrngRef.current!;
    const phaseOffset = Math.floor(seedData.panelSeeds[PanelSlot.LossAnim] % 250);
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        const cycle = cycleStore.get();
        setValues(prev => {
          const nextLvl = nextLevel(levelRef.current, cycle, prng);
          const nextValLvl = nextValLevel(valLevelRef.current, nextLvl, prng);
          levelRef.current = nextLvl;
          valLevelRef.current = nextValLvl;
          setValValues(curVal => [...curVal.slice(1), nextValLvl]);
          stepRef.current += 1;
          setStep(stepRef.current);
          return [...prev.slice(1), nextLvl];
        });
      }, 300);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData, values.length]);

  const PAD_L = 30;
  const PAD_R = 6;
  const PAD_T = 6;
  const PAD_B = 16;
  const chartW = Math.max(0, size.w - PAD_L - PAD_R);
  const chartH = Math.max(0, size.h - PAD_T - PAD_B);

  const xAt = (i: number) => PAD_L + (i / (WINDOW - 1)) * chartW;
  const yAt = (v: number) => PAD_T + chartH - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * chartH;

  const linePath = (arr: number[]) =>
    arr.length === 0
      ? ''
      : 'M ' + arr.map((v, i) => `${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' L ');

  const fillPath = (arr: number[]) => {
    if (arr.length === 0) return '';
    const top = arr.map((v, i) => `${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' L ');
    return `M ${xAt(0).toFixed(2)} ${yAt(Y_MIN).toFixed(2)} L ${top} L ${xAt(arr.length - 1).toFixed(2)} ${yAt(Y_MIN).toFixed(2)} Z`;
  };

  const yTicks = [1.0, 0.75, 0.5, 0.25, 0.0];
  const xTickCount = 5;

  return (
    <div className="retro-panel h-full flex flex-col min-h-0">
      <div className="retro-label shrink-0 flex justify-between items-center">
        <span>LOSS</span>
        <span className="font-mono text-[10px] opacity-60" style={{ color: palette.bg }}>
          step {step.toString().padStart(4, '0')}
        </span>
      </div>
      <div
        ref={bodyRef}
        className="flex-1 relative overflow-hidden"
        style={{ background: palette.bg }}
      >
        {size.w > 0 && size.h > 0 && (
          <svg width={size.w} height={size.h} className="block">
            {/* Grid */}
            {yTicks.map((t, i) => (
              <line
                key={`gy-${i}`}
                x1={PAD_L}
                x2={PAD_L + chartW}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke={palette.ink}
                strokeOpacity={0.18}
                strokeDasharray="2 3"
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: xTickCount }).map((_, i) => {
              const x = PAD_L + (i / (xTickCount - 1)) * chartW;
              return (
                <line
                  key={`gx-${i}`}
                  x1={x}
                  x2={x}
                  y1={PAD_T}
                  y2={PAD_T + chartH}
                  stroke={palette.ink}
                  strokeOpacity={0.18}
                  strokeDasharray="2 3"
                  strokeWidth={1}
                />
              );
            })}

            {/* Axes */}
            <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + chartH} stroke={palette.ink} strokeWidth={1} />
            <line x1={PAD_L} x2={PAD_L + chartW} y1={PAD_T + chartH} y2={PAD_T + chartH} stroke={palette.ink} strokeWidth={1} />

            {/* Train fill + line */}
            <path d={fillPath(values)} fill={palette.accent1} fillOpacity={0.18} />
            <path d={linePath(values)} fill="none" stroke={palette.accent1} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />

            {/* Validation curve (no fill, dashed-feel via opacity) */}
            <path d={linePath(valValues)} fill="none" stroke={palette.accent2} strokeOpacity={0.65} strokeWidth={1.2} strokeDasharray="3 2" strokeLinejoin="round" strokeLinecap="round" />

            {/* Y-axis labels */}
            {yTicks.map((t, i) => (
              <text
                key={`yt-${i}`}
                x={PAD_L - 3}
                y={yAt(t) + 3}
                textAnchor="end"
                fontSize={9}
                fontFamily="ui-monospace, monospace"
                fill={palette.ink}
                opacity={0.7}
              >
                {t.toFixed(2)}
              </text>
            ))}

            {/* X-axis labels: step counters */}
            {Array.from({ length: xTickCount }).map((_, i) => {
              const x = PAD_L + (i / (xTickCount - 1)) * chartW;
              const stepAt = Math.max(0, step - WINDOW + Math.round((i / (xTickCount - 1)) * (WINDOW - 1)));
              return (
                <text
                  key={`xt-${i}`}
                  x={x}
                  y={PAD_T + chartH + 11}
                  textAnchor={i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle'}
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                  fill={palette.ink}
                  opacity={0.7}
                >
                  {stepAt}
                </text>
              );
            })}

            {/* L cassette tag in top-left of chart */}
            <g>
              <rect x={PAD_L + 4} y={PAD_T + 4} width={14} height={12} fill={palette.ink} />
              <text x={PAD_L + 11} y={PAD_T + 13} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace" fontWeight={700} fill={palette.bg}>
                L
              </text>
            </g>

            {/* Legend in top-right of chart */}
            <g>
              <rect x={PAD_L + chartW - 70} y={PAD_T + 4} width={6} height={6} fill={palette.accent1} />
              <text x={PAD_L + chartW - 60} y={PAD_T + 10} fontSize={9} fontFamily="ui-monospace, monospace" fill={palette.ink} opacity={0.8}>
                train
              </text>
              <rect x={PAD_L + chartW - 36} y={PAD_T + 4} width={6} height={6} fill={palette.accent2} fillOpacity={0.7} />
              <text x={PAD_L + chartW - 26} y={PAD_T + 10} fontSize={9} fontFamily="ui-monospace, monospace" fill={palette.ink} opacity={0.8}>
                val
              </text>
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

// Train-loss tick: race toward the cycle-driven target with a small
// per-tick noise so the curve still breathes between phase transitions.
function nextLevel(prev: number, cycle: CycleState, prng: SeededPrng): number {
  const target = targetTrainLoss(cycle);
  const drift = (target - prev) * 0.4;
  const noise = (prng() - 0.5) * 0.04;
  return Math.max(0.02, Math.min(1, prev + drift + noise));
}

// Validation tracks training loss with a slight positive offset and
// reduced volatility so the two curves read clearly side-by-side.
function nextValLevel(prev: number, train: number, prng: SeededPrng): number {
  const target = Math.min(1, train + 0.06);
  const drift = (target - prev) * 0.4;
  const noise = (prng() - 0.5) * 0.025;
  return Math.max(0.02, Math.min(1, prev + drift + noise));
}
